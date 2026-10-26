/** Nut arrays are ordered bottom-to-top. Rules never mutate the given state. */
const copyRods = (rods) => rods.map((rod) => [...rod]);
const modes = new Set(['classic', 'fog', 'collect']);
const validColor = (color) => Number.isInteger(color) && color >= 0 && color <= 19;
const modeOf = (state) => state.mode === undefined ? 'classic' : state.mode;

function validBoard(value) {
  return Boolean(value && Number.isInteger(value.capacity) && value.capacity > 0 &&
    Array.isArray(value.rods) && value.rods.length > 0 &&
    value.rods.every((rod) => Array.isArray(rod) && rod.length <= value.capacity &&
      rod.every(validColor)));
}

export function createState(level) {
  if (!validBoard(level) || !modes.has(modeOf(level))) throw new TypeError('Invalid level rules or board.');
  const state = { mode: modeOf(level), capacity: level.capacity, rods: copyRods(level.rods), history: [], moves: 0 };
  if (state.mode === 'fog') {
    state.revealed = state.rods.map((rod) => rod.map(() => false));
    state.rods.forEach((_, index) => revealTop(state, index));
  }
  if (state.mode === 'collect') {
    const counts = new Map();
    for (const rod of state.rods) for (const color of rod) counts.set(color, (counts.get(color) ?? 0) + 1);
    if (!validTargets(level.targetOrder) || level.targetOrder.length !== counts.size ||
        !level.targetOrder.every((color) => counts.get(color) === state.capacity)) {
      throw new TypeError('Collection targets must list every board color once, with one full rod of each color.');
    }
    state.targetOrder = [...level.targetOrder];
    state.collected = 0;
    settleCollections(state);
  }
  return state;
}

function validTargets(targetOrder) {
  return Array.isArray(targetOrder) && targetOrder.length > 0 &&
    targetOrder.every(validColor) && new Set(targetOrder).size === targetOrder.length;
}

function validState(state) {
  if (!validBoard(state) || !modes.has(modeOf(state))) return false;
  if (modeOf(state) === 'fog') return Array.isArray(state.revealed) &&
    state.revealed.length === state.rods.length && state.revealed.every((rod, index) =>
      Array.isArray(rod) && rod.length === state.rods[index].length && rod.every((known) => typeof known === 'boolean'));
  if (modeOf(state) === 'collect') return validTargets(state.targetOrder) &&
    Number.isInteger(state.collected) && state.collected >= 0 && state.collected <= state.targetOrder.length;
  return true;
}

function revealTop(state, index) {
  const rod = state.rods[index];
  for (let position = rod.length - getTopRun(rod); position < rod.length; position += 1) state.revealed[index][position] = true;
}

function settleCollections(state) {
  const collectedColors = [];
  while (state.collected < state.targetOrder.length) {
    const color = state.targetOrder[state.collected];
    const index = state.rods.findIndex((rod) => rod.length === state.capacity && rod.every((nut) => nut === color));
    if (index < 0) break;
    state.rods[index] = [];
    state.collected += 1;
    collectedColors.push(color);
  }
  return collectedColors;
}

function snapshot(state) {
  const result = { mode: modeOf(state), capacity: state.capacity, rods: copyRods(state.rods), moves: state.moves };
  if (result.mode === 'fog') result.revealed = copyRods(state.revealed);
  if (result.mode === 'collect') {
    result.targetOrder = [...state.targetOrder];
    result.collected = state.collected;
  }
  return result;
}

/** Return a copy suitable for display; hidden fog nuts never expose their color. */
export function getVisibleRod(state, index) {
  if (!validState(state) || !Number.isInteger(index) || index < 0 || index >= state.rods.length) return [];
  return state.rods[index].map((color, position) => modeOf(state) === 'fog' && !state.revealed[index][position] ? null : color);
}

export function getTopColor(rod) {
  return rod.length ? rod[rod.length - 1] : null;
}

export function getTopRun(rod) {
  const color = getTopColor(rod);
  let count = 0;
  for (let index = rod.length - 1; index >= 0 && rod[index] === color; index -= 1) count += 1;
  return count;
}

export function getMove(state, from, to) {
  const reject = (reason) => ({ ok: false, reason, count: 0, color: null });
  if (!validState(state) || !Number.isInteger(from) || !Number.isInteger(to) ||
      from < 0 || to < 0 || from >= state.rods.length || to >= state.rods.length) return reject('invalid');
  if (from === to) return reject('same');
  const source = state.rods[from];
  const destination = state.rods[to];
  if (!source.length) return reject('empty-source');
  if (destination.length >= state.capacity) return reject('full');
  const color = getTopColor(source);
  if (destination.length && getTopColor(destination) !== color) return reject('different-color');
  return { ok: true, reason: null, count: Math.min(getTopRun(source), state.capacity - destination.length), color };
}

export function applyMove(state, from, to) {
  const result = getMove(state, from, to);
  if (!result.ok) return { ok: false, reason: result.reason, state, move: null };
  const next = { ...snapshot(state), history: [...state.history, snapshot(state)], moves: state.moves + 1 };
  const moved = next.rods[from].splice(-result.count);
  next.rods[to].push(...moved);
  if (next.mode === 'fog') {
    next.revealed[from].splice(-result.count);
    next.revealed[to].push(...moved.map(() => true));
    revealTop(next, from);
  }
  const move = { from, to, count: result.count, color: result.color };
  if (next.mode === 'collect') move.collectedColors = settleCollections(next);
  return {
    ok: true, reason: null,
    state: next,
    move
  };
}

/** Add a free working rod as its own undoable action; moves count nut transfers only. */
export function addRod(state) {
  if (!validState(state) || !Array.isArray(state.history) ||
      !Number.isSafeInteger(state.moves) || state.moves < 0) {
    return { ok: false, reason: 'invalid', state, rodIndex: null };
  }
  const next = { ...snapshot(state), history: [...state.history, snapshot(state)] };
  const rodIndex = next.rods.length;
  next.rods.push([]);
  if (next.mode === 'fog') next.revealed.push([]);
  return { ok: true, reason: null, state: next, rodIndex };
}

export function undo(state) {
  if (!state || !Array.isArray(state.history) || !state.history.length) return { ok: false, state };
  const previous = state.history[state.history.length - 1];
  const restored = { ...previous, mode: previous.mode ?? modeOf(state), capacity: previous.capacity ?? state.capacity };
  return {
    ok: true,
    state: { ...snapshot(restored), history: state.history.slice(0, -1) }
  };
}

export function isSolved(state) {
  if (!validState(state)) return false;
  if (modeOf(state) === 'collect') return state.collected === state.targetOrder.length && state.rods.every((rod) => !rod.length);
  return state.rods.some((rod) => rod.length > 0) &&
    state.rods.every((rod) => !rod.length || (rod.length === state.capacity && rod.every((color) => color === rod[0])));
}

export function getLegalMoves(state) {
  if (!validState(state)) return [];
  const moves = [];
  for (let from = 0; from < state.rods.length; from += 1) {
    for (let to = 0; to < state.rods.length; to += 1) {
      const move = getMove(state, from, to);
      if (move.ok) moves.push({ from, to, count: move.count, color: move.color });
    }
  }
  return moves;
}
