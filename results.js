import { createState, isSolved } from './engine.js?v=4';

const modes = new Set(['classic', 'fog', 'collect']);
const categories = ['standard', 'assisted'];
const finiteTime = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const textId = value => typeof value === 'string' && value.length > 0;
const modeOf = value => value?.mode ?? 'classic';
const categoryOf = rodAdds => rodAdds > 0 ? 'assisted' : 'standard';
let fallbackSequence = 0;

function newId() {
  try {
    if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  } catch { /* A local fallback also works in browser contexts without secure crypto. */ }
  fallbackSequence += 1;
  return `run-${Date.now().toString(36)}-${fallbackSequence.toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function knownRodAdds(level, state) {
  let previous = level.rods.length;
  let added = 0;
  for (const frame of [...(Array.isArray(state?.history) ? state.history : []), state]) {
    const length = frame?.rods?.length;
    if (!count(length)) continue;
    if (length > previous) added += length - previous;
    previous = length;
  }
  return added;
}

function freshBoard(level, state) {
  if (!state || state.moves !== 0 || !Array.isArray(state.history) || state.history.length || isSolved(state)) return false;
  try {
    const initial = createState(level);
    return ['mode', 'capacity', 'rods', 'revealed', 'targetOrder', 'collected'].every(key =>
      JSON.stringify(state[key]) === JSON.stringify(initial[key]));
  } catch { return false; }
}

function resultCopy(result) {
  return { id: result.id, levelId: result.levelId, mode: result.mode,
    elapsedMs: result.elapsedMs, moves: result.moves, rodAdds: result.rodAdds,
    extraRods: result.extraRods, category: result.category, eligible: result.eligible };
}

function validResult(result, level, category) {
  return Boolean(object(result) && textId(result.id) && Number.isSafeInteger(result.levelId) &&
    modes.has(result.mode) && finiteTime(result.elapsedMs) && count(result.moves) &&
    count(result.rodAdds) && count(result.extraRods) && result.extraRods <= result.rodAdds &&
    result.category === categoryOf(result.rodAdds) && typeof result.eligible === 'boolean' &&
    (!level || (result.levelId === level.id && result.mode === modeOf(level))) &&
    (!category || result.category === category));
}

function runCopy(run) {
  return { id: run.id, levelId: run.levelId, mode: run.mode, elapsedMs: run.elapsedMs,
    rodAdds: run.rodAdds, eligible: run.eligible, finished: run.finished,
    result: run.result ? resultCopy(run.result) : null, completion: run.completion };
}

function validRun(run, level, state) {
  if (!object(run) || !textId(run.id) || run.levelId !== level.id || run.mode !== modeOf(level) ||
      !finiteTime(run.elapsedMs) || !count(run.rodAdds) || typeof run.eligible !== 'boolean' ||
      typeof run.finished !== 'boolean' || !count(run.completion)) return false;
  if (state && (modeOf(state) !== modeOf(level) || state.capacity !== level.capacity ||
      !Array.isArray(state.rods) || state.rods.length < level.rods.length ||
      !count(state.moves) || run.rodAdds < knownRodAdds(level, state))) return false;
  if (!run.finished) return run.result === null;
  const result = run.result;
  return Boolean(state && isSolved(state) && run.completion > 0 &&
    validResult(result, level) && result.id === `${run.id}:${run.completion}` &&
    result.elapsedMs === run.elapsedMs && result.rodAdds === run.rodAdds &&
    result.eligible === run.eligible && result.moves === state.moves &&
    result.extraRods === state.rods.length - level.rods.length);
}

/** No wall-clock timestamp is saved: closed pages and background time add nothing. */
export function createRun(level, state, savedRun) {
  if (validRun(savedRun, level, state)) return runCopy(savedRun);
  return { id: newId(), levelId: level.id, mode: modeOf(level), elapsedMs: 0,
    rodAdds: knownRodAdds(level, state), eligible: freshBoard(level, state),
    finished: false, result: null, completion: 0 };
}

export function advanceRun(run, deltaMs) {
  const elapsedMs = !run.finished && finiteTime(deltaMs) && Number.isFinite(run.elapsedMs + deltaMs)
    ? run.elapsedMs + deltaMs : run.elapsedMs;
  return { ...run, elapsedMs };
}

export function noteRodAdded(run) {
  return { ...run, rodAdds: run.finished ? run.rodAdds : run.rodAdds + 1 };
}

/** Undo after a win resumes the same attempt, including all its time and assistance. */
export function resumeRun(run) {
  return { ...run, finished: false, result: null };
}

export function finishRun(run, level, state) {
  if (run.finished) return { run, result: run.result };
  if (!isSolved(state) || !validRun(run, level, state)) return { run, result: null };
  const completion = run.completion + 1;
  const result = { id: `${run.id}:${completion}`, levelId: level.id, mode: modeOf(level),
    elapsedMs: run.elapsedMs, moves: state.moves, rodAdds: run.rodAdds,
    extraRods: state.rods.length - level.rods.length,
    category: categoryOf(run.rodAdds), eligible: run.eligible };
  return { run: { ...run, completion, finished: true, result }, result };
}

function cleanRecords(records, levelsById) {
  if (!object(records)) return {};
  const cleaned = {};
  for (const [key, entry] of Object.entries(records)) {
    const levelId = Number(key);
    if (!Number.isSafeInteger(levelId) || String(levelId) !== key || !object(entry)) continue;
    const level = levelsById?.get(levelId);
    if (levelsById && !level) continue;
    const saved = {};
    for (const category of categories) {
      if (!object(entry[category])) continue;
      const scores = {};
      for (const slot of ['bestTime', 'bestMoves']) {
        const score = entry[category][slot];
        if (validResult(score, level, category) && score.eligible && score.levelId === levelId)
          scores[slot] = resultCopy(score);
      }
      if (Object.keys(scores).length) saved[category] = scores;
    }
    if (Object.keys(saved).length) cleaned[levelId] = saved;
  }
  return cleaned;
}

/** Records are independent for every level and for standard/assisted attempts. */
export function updateRecords(records, result) {
  const cleaned = cleanRecords(records);
  const unchanged = () => ({ records: cleaned, newBestTime: false, newBestMoves: false, first: false });
  if (!validResult(result) || !result.eligible) return unchanged();
  const current = cleaned[result.levelId]?.[result.category];
  if (categories.some(category => ['bestTime', 'bestMoves'].some(slot =>
      cleaned[result.levelId]?.[category]?.[slot]?.id === result.id))) return unchanged();
  const first = !current;
  const time = current?.bestTime;
  const moves = current?.bestMoves;
  const newBestTime = !time || result.elapsedMs < time.elapsedMs ||
    (result.elapsedMs === time.elapsedMs && result.moves < time.moves);
  const newBestMoves = !moves || result.moves < moves.moves ||
    (result.moves === moves.moves && result.elapsedMs < moves.elapsedMs);
  const scores = { ...current };
  if (newBestTime) scores.bestTime = resultCopy(result);
  if (newBestMoves) scores.bestMoves = resultCopy(result);
  return { records: { ...cleaned, [result.levelId]: { ...cleaned[result.levelId],
    [result.category]: scores } }, newBestTime, newBestMoves, first };
}

export function formatDuration(ms) {
  const seconds = Math.floor((finiteTime(ms) ? ms : 0) / 1000);
  const pad = value => String(value).padStart(2, '0');
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = seconds % 60;
  return seconds >= 3600 ? `${pad(Math.floor(seconds / 3600))}:${pad(minutes)}:${pad(remainder)}`
    : `${pad(minutes)}:${pad(remainder)}`;
}

/** The caller supplies already-restored boards, so bad metadata cannot discard a board. */
export function sanitizeRuns(levels, entries, boardsById) {
  if (!Array.isArray(entries) || !Array.isArray(levels)) return [];
  const levelsById = new Map(levels.map(level => [level.id, level]));
  const seen = new Set();
  const result = [];
  for (const entry of entries) {
    if (!object(entry) || seen.has(entry.levelId)) continue;
    const level = levelsById.get(entry.levelId);
    const board = boardsById instanceof Map ? boardsById.get(entry.levelId) : boardsById?.[entry.levelId];
    const state = board?.state ?? board;
    if (!level || (boardsById && !state) || !validRun(entry.run, level, state)) continue;
    seen.add(entry.levelId);
    result.push({ levelId: entry.levelId, run: runCopy(entry.run) });
  }
  return result;
}

export function sanitizeRecords(levels, records) {
  return cleanRecords(records, new Map((Array.isArray(levels) ? levels : []).map(level => [level.id, level])));
}
