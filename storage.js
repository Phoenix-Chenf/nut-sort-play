import { createState, getMove, applyMove, addRod } from './engine.js?v=4';
import { sanitizeRuns, sanitizeRecords } from './results.js?v=5';

// v1 remains untouched: its level identifiers describe the previous catalog.
export const STORAGE_KEY = 'nut-sort-play-v2';

function getStorage(supplied) {
  try { return supplied ?? globalThis.localStorage ?? null; } catch { return null; }
}

function bag(rods, removed = [], capacity = 0) {
  const counts = new Map();
  for (const rod of rods) for (const color of rod) counts.set(color, (counts.get(color) ?? 0) + 1);
  for (const color of removed) counts.set(color, (counts.get(color) ?? 0) + capacity);
  return JSON.stringify([...counts].sort((a, b) => a[0] - b[0]));
}

function frameOf(state) {
  const frame = { mode: state.mode, capacity: state.capacity,
    rods: state.rods.map(rod => [...rod]), moves: state.moves };
  if (state.mode === 'fog') frame.revealed = state.revealed.map(rod => [...rod]);
  if (state.mode === 'collect') {
    frame.targetOrder = [...state.targetOrder];
    frame.collected = state.collected;
  }
  return frame;
}

function sameFrame(a, b) {
  return JSON.stringify([a.mode, a.capacity, a.moves, a.rods, a.revealed, a.targetOrder, a.collected]) ===
    JSON.stringify([b.mode, b.capacity, b.moves, b.rods, b.revealed, b.targetOrder, b.collected]);
}

const sameRod = (a, b) => a.length === b.length && a.every((color, index) => color === b[index]);

function findTransition(current, expected) {
  // Adding one empty tail rod is a real action, with no nut-transfer move counted.
  if (expected.moves === current.moves && expected.rods.length === current.rods.length + 1) {
    const candidate = addRod({ ...current, history: [] }).state;
    return sameFrame(candidate, expected) ? { state: candidate, action: [] } : null;
  }
  if (expected.moves !== current.moves + 1 || expected.rods.length !== current.rods.length) return null;
  // A move always shortens its source by the moved group; collection cannot add nuts.
  // Deriving that source avoids enumerating every rod pair on every historical frame.
  for (let from = 0; from < current.rods.length; from += 1) {
    const count = current.rods[from].length - expected.rods[from].length;
    if (count <= 0 || !sameRod(current.rods[from].slice(0, -count), expected.rods[from])) continue;
    for (let to = 0; to < current.rods.length; to += 1) {
      const move = getMove(current, from, to);
      if (!move.ok || move.count !== count) continue;
      const destination = [...current.rods[to], ...current.rods[from].slice(-count)];
      if (!sameRod(destination, expected.rods[to]) &&
          !(current.mode === 'collect' && expected.rods[to].length === 0)) continue;
      // Each candidate starts with an empty history, keeping replay linear in move count.
      const candidate = applyMove({ ...current, history: [] }, from, to).state;
      if (sameFrame(candidate, expected)) return { state: candidate, action: [from, to] };
    }
  }
  return null;
}

/** Store reversible actions instead of copying every entire board at each move. */
function compactState(state) {
  try {
    if (!state || !Array.isArray(state.history) || !state.history.length || Object.hasOwn(state, 'undo')) return state;
    const frames = [...state.history, state];
    const actions = [];
    for (let index = 1; index < frames.length; index += 1) {
      const transition = findTransition(frames[index - 1], frames[index]);
      // Malformed inputs keep the legacy representation, so normal validation
      // still rejects them rather than silently repairing a damaged history.
      if (!transition) return state;
      actions.push(transition.action);
    }
    return { ...frameOf(state), undo: { format: 'actions-v1', start: frameOf(frames[0]), actions } };
  } catch { return state; }
}

function restoreCompactState(state, level, initial, expectedBag) {
  const compact = state.undo;
  if (Object.hasOwn(state, 'history') || !compact || compact.format !== 'actions-v1' ||
      !Array.isArray(compact.actions) || !compact.actions.length ||
      !validFrame(state, level, initial, expectedBag) ||
      !validFrame(compact.start, level, initial, expectedBag) || !sameFrame(compact.start, initial)) return null;
  let current = frameOf(initial);
  const history = [];
  for (const action of compact.actions) {
    if (!Array.isArray(action) || (action.length !== 0 && action.length !== 2) ||
        !action.every(Number.isSafeInteger)) return null;
    const playable = { ...current, history: [] };
    const result = action.length ? applyMove(playable, action[0], action[1]) : addRod(playable);
    if (!result.ok) return null;
    history.push(current);
    current = frameOf(result.state);
  }
  // Never trust persisted visibility, collection, or clocks as a board proof.
  return sameFrame(current, state) ? { ...current, history } : null;
}

function validFrame(frame, level, initial, expectedBag) {
  if (!frame || frame.mode !== initial.mode || frame.capacity !== level.capacity ||
      !Number.isSafeInteger(frame.moves) || frame.moves < 0 ||
      !Array.isArray(frame.rods) || frame.rods.length < level.rods.length ||
      !frame.rods.every(rod => Array.isArray(rod) && rod.length <= level.capacity &&
        rod.every(color => Number.isInteger(color) && color >= 0 && color <= 19))) return false;
  if (initial.mode === 'fog') {
    if (!Array.isArray(frame.revealed) || frame.revealed.length !== frame.rods.length ||
        !frame.revealed.every((rod, index) => Array.isArray(rod) && rod.length === frame.rods[index].length &&
          rod.every(known => typeof known === 'boolean'))) return false;
  } else if (frame.revealed !== undefined) return false;
  let removed = [];
  if (initial.mode === 'collect') {
    if (!Array.isArray(frame.targetOrder) || frame.targetOrder.length !== initial.targetOrder.length ||
        !frame.targetOrder.every((color, index) => color === initial.targetOrder[index]) ||
        !Number.isInteger(frame.collected) || frame.collected < 0 || frame.collected > initial.targetOrder.length) return false;
    removed = initial.targetOrder.slice(0, frame.collected);
  } else if (frame.targetOrder !== undefined || frame.collected !== undefined) return false;
  return bag(frame.rods, removed, level.capacity) === expectedBag;
}

/** Replay every transition so saved visibility and collection cursors carry no authority. */
function restoreState(level, state) {
  if (!state || !Number.isSafeInteger(state.moves) || state.moves < 0) return null;
  const initial = createState(level);
  const expectedBag = bag(level.rods);
  if (Object.hasOwn(state, 'undo')) return restoreCompactState(state, level, initial, expectedBag);
  if (!Array.isArray(state.history)) return null;
  const frames = [...state.history, state];
  if (!frames.every(frame => validFrame(frame, level, initial, expectedBag))) return null;
  let current = frameOf(initial);
  if (!sameFrame(current, frames[0])) return null;
  const history = [];
  for (let index = 1; index < frames.length; index += 1) {
    const next = findTransition(current, frames[index]);
    if (!next) return null;
    history.push(frameOf(current));
    current = frameOf(next.state);
  }
  return { ...current, history };
}

function restoreBoard(entry, levelsById) {
  try {
    if (!entry || !Number.isInteger(entry.levelId)) return null;
    const level = levelsById.get(entry.levelId);
    if (!level) return null;
    const state = restoreState(level, entry.state);
    return state ? { levelId: level.id, state } : null;
  } catch { return null; }
}

export function loadProgress(levels, supplied) {
  try {
    const raw = getStorage(supplied)?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (data?.version !== 2 || !Array.isArray(levels)) return null;
    const levelsById = new Map(levels.map(level => [level.id, level]));
    const active = restoreBoard(data, levelsById);
    if (!active) return null;
    const completed = [...new Set((Array.isArray(data.completed) ? data.completed : [])
      .filter(id => Number.isInteger(id) && levelsById.has(id)))].sort((a, b) => a - b);
    const result = { ...active, completed };
    if (Array.isArray(data.boards)) {
      const seen = new Set();
      result.boards = data.boards.map(entry => restoreBoard(entry, levelsById)).filter(entry => {
        if (!entry || seen.has(entry.levelId)) return false;
        seen.add(entry.levelId);
        return true;
      });
    }
    if (Object.hasOwn(data, 'runs')) {
      const boardsById = new Map((result.boards ?? []).map(entry => [entry.levelId, entry.state]));
      // The active board is authoritative when a stored background copy is stale.
      boardsById.set(active.levelId, active.state);
      result.runs = sanitizeRuns(levels, data.runs, boardsById);
    }
    if (Object.hasOwn(data, 'records')) result.records = sanitizeRecords(levels, data.records);
    return result;
  } catch { return null; }
}

function writeProgress(payload, supplied, cache) {
  try {
    const storage = getStorage(supplied);
    if (!storage || !payload?.state || !Number.isInteger(payload.levelId)) return false;
    const encode = state => {
      if (!state || typeof state !== 'object') return state;
      if (!cache.has(state)) cache.set(state, compactState(state));
      return cache.get(state);
    };
    const data = { ...payload, state: encode(payload.state), version: 2 };
    if (Array.isArray(payload.boards)) data.boards = payload.boards.map(entry =>
      entry && typeof entry === 'object' ? { ...entry, state: encode(entry.state) } : entry);
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch { return false; }
}

/** General callers may mutate their own state objects between saves. */
export function saveProgress(payload, supplied) {
  return writeProgress(payload, supplied, new WeakMap());
}

/**
 * For immutable engine states only: retain encoded boards across saves.
 * Attempt clocks and record metadata are always read fresh from the payload.
 */
export function createProgressSaver() {
  const cache = new WeakMap();
  return (payload, supplied) => writeProgress(payload, supplied, cache);
}
