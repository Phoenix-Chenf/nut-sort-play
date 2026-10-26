/** Bounded, cooperative proofs for hints and undo recovery. No DOM or worker dependency. */
import { createState, applyMove, getMove, isSolved } from './engine.js?v=4';

const now = () => globalThis.performance?.now?.() ?? Date.now();
const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
const modeOf = (state) => state.mode ?? 'classic';
const copy = (value) => Array.isArray(value) ? value.map(copy) :
  value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)])) : value;

function checkAbort(signal) {
  if (!signal?.aborted) return;
  const error = new Error('The analysis was cancelled.');
  error.name = 'AbortError';
  throw error;
}

function limits(options = {}) {
  const amount = (value, fallback) => typeof value === 'number' && !Number.isNaN(value) ? Math.max(0, value) : fallback;
  return { maxNodes: Math.floor(amount(options.maxNodes, 4000)), timeMs: amount(options.timeMs, 90), signal: options.signal };
}

// The engine's validation also checks fog masks and collection targets.
const valid = (state) => getMove(state, 0, 0).reason === 'same';

function engineState(state) {
  const result = { mode: modeOf(state), capacity: state.capacity, rods: state.rods.map((rod) => [...rod]),
    moves: state.moves ?? 0, history: [] };
  if (result.mode === 'fog') result.revealed = state.revealed.map((rod) => [...rod]);
  if (result.mode === 'collect') {
    result.targetOrder = [...state.targetOrder];
    result.collected = state.collected;
  }
  return result;
}

function physical(state) {
  return { mode: modeOf(state), capacity: state.capacity, rods: state.rods,
    targetOrder: state.targetOrder, collected: state.collected };
}

function rulesKey(state) {
  const collection = state.mode === 'collect' ? `${state.targetOrder.join(',')}|${state.collected}` : '';
  return `${modeOf(state)}|${state.capacity}|${collection}`;
}

function key(state) {
  // Search and dead proofs describe the entire board. Extra empty rods add
  // legal options, so a smaller board's exhausted graph says nothing about it.
  return `${rulesKey(state)}|${state.rods.length}|${state.rods.map((rod) => rod.join(',')).sort().join(';')}`;
}

function certificateKey(state) {
  // This relaxed identity is only for reusing a winning proof. A certificate
  // with no more rods embeds in this board by leaving its extra empty rods idle.
  return `${rulesKey(state)}|${state.rods.filter((rod) => rod.length).map((rod) => rod.join(',')).sort().join(';')}`;
}

function solved(state) {
  if (state.mode === 'collect') return state.collected === state.targetOrder.length && state.rods.every((rod) => !rod.length);
  return state.rods.some((rod) => rod.length) && state.rods.every((rod) =>
    !rod.length || (rod.length === state.capacity && rod.every((color) => color === rod[0])));
}

// Only proof search uses this compact transition. Every returned winning path is
// replayed through applyMove, so the public answer always uses the actual rules.
function transfer(state, move) {
  const rods = state.rods.slice();
  rods[move.from] = rods[move.from].slice(0, -move.count);
  rods[move.to] = [...rods[move.to], ...Array(move.count).fill(move.color)];
  let collected = state.collected;
  if (state.mode === 'collect') {
    while (collected < state.targetOrder.length) {
      const color = state.targetOrder[collected];
      const index = rods.findIndex((rod) => rod.length === state.capacity && rod.every((nut) => nut === color));
      if (index < 0) break;
      rods[index] = [];
      collected += 1;
    }
  }
  return { ...state, rods, collected };
}

function movesFrom(state) {
  const moves = [];
  for (let from = 0; from < state.rods.length; from += 1) {
    const source = state.rods[from];
    if (!source.length) continue;
    const color = source[source.length - 1];
    let run = 1;
    while (run < source.length && source[source.length - 1 - run] === color) run += 1;
    for (let to = 0; to < state.rods.length; to += 1) {
      const destination = state.rods[to];
      if (from === to || destination.length >= state.capacity ||
          (destination.length && destination[destination.length - 1] !== color)) continue;
      const count = Math.min(run, state.capacity - destination.length);
      // Ordering is only a speed preference. Full uniform rods, reversals, and
      // transfers to every empty rod remain in the complete search graph.
      const score = (destination.length ? 20 : 0) + (count === source.length ? 12 : 0) +
        (destination.length + count === state.capacity ? 30 : 0) - (!destination.length && run === source.length ? 18 : 0);
      moves.push({ from, to, count, color, score });
    }
  }
  moves.sort((a, b) => b.score - a.score);
  return moves;
}

function replay(state, moves, signal, deadline = Infinity) {
  let current = engineState(state);
  const frames = [current];
  for (let index = 0; index < moves.length; index += 1) {
    checkAbort(signal);
    if (index % 16 === 0 && now() >= deadline) return null;
    const move = moves[index];
    const result = applyMove(current, move.from, move.to);
    if (!result.ok) return null;
    current = { ...result.state, history: [] };
    frames.push(current);
  }
  return isSolved(current) ? frames : null;
}

function mappedSuffix(certificate, state) {
  const positions = new Map();
  state.rods.forEach((rod, index) => {
    const signature = rod.join(',');
    if (!positions.has(signature)) positions.set(signature, []);
    positions.get(signature).push(index);
  });
  const mapping = certificate.state.rods.map((rod) => positions.get(rod.join(',')).pop());
  return certificate.path.slice(certificate.index).map((move) => ({ from: mapping[move.from], to: mapping[move.to] }));
}

export function createAdvisor(level) {
  const initial = createState(level);
  const certificates = new Map();
  const expandable = new Map();
  const pinned = new Set();
  const dead = new Set();

  function certificateFor(state, signature = key(state)) {
    const exact = certificates.get(signature);
    if (exact) return exact;
    const candidates = expandable.get(certificateKey(state));
    if (!candidates) return null;
    let best = null;
    for (const [count, certificate] of candidates) {
      if (count <= state.rods.length && (!best ||
          certificate.path.length - certificate.index < best.path.length - best.index)) best = certificate;
    }
    return best;
  }

  function forget(signature, certificate) {
    certificates.delete(signature);
    const relaxed = certificateKey(certificate.state);
    const candidates = expandable.get(relaxed);
    candidates.delete(certificate.state.rods.length);
    if (!candidates.size) expandable.delete(relaxed);
  }

  function remember(frames, path, pin = false) {
    path = path.map((move) => ({ from: move.from, to: move.to }));
    // Initial certificates retain every prefix; learned routes keep a bounded
    // subset so repeated manual searches do not retain an unbounded graph.
    const stride = pin ? 1 : Math.max(1, Math.ceil(frames.length / 180));
    for (let index = 0; index < frames.length; index += stride) {
      const state = physical(frames[index]);
      const signature = key(state);
      const previous = certificates.get(signature);
      if (!previous || previous.path.length - previous.index > path.length - index) {
        const certificate = { state, path, index };
        certificates.set(signature, certificate);
        const relaxed = certificateKey(state);
        if (!expandable.has(relaxed)) expandable.set(relaxed, new Map());
        expandable.get(relaxed).set(state.rods.length, certificate);
      }
      if (pin) pinned.add(signature);
    }
    if (certificates.size > pinned.size + 1200) {
      for (const [signature, certificate] of certificates) {
        if (!pinned.has(signature)) forget(signature, certificate);
        if (certificates.size <= pinned.size + 900) break;
      }
    }
  }

  // No prefix is trusted until the *entire* supplied route wins in the engine.
  if (Array.isArray(level.solution)) {
    const path = level.solution.map((move) => ({ from: move?.from, to: move?.to }));
    const frames = replay(initial, path);
    if (frames) remember(frames, path, true);
  }

  function known(state, signal) {
    checkAbort(signal);
    if (!valid(state)) return { status: 'unknown', visited: 0, reason: 'invalid-state' };
    if (isSolved(state)) return { status: 'solved', moves: [], visited: 0 };
    const signature = key(state);
    const certificate = certificateFor(state, signature);
    if (certificate) {
      const moves = mappedSuffix(certificate, state);
      if (replay(state, moves, signal)) return { status: 'solvable', moves, visited: 0, reason: 'verified-certificate' };
    }
    if (dead.has(signature)) return { status: 'dead', visited: 0, reason: 'exhausted' };
    return null;
  }

  async function analyze(state, options = {}) {
    const budget = limits(options);
    const immediate = known(state, budget.signal);
    if (immediate) return immediate;
    const deadline = now() + budget.timeMs;
    const unknown = (visited, reason) => ({ status: 'unknown', visited, reason });
    if (!budget.maxNodes) return unknown(0, 'node-budget');
    if (!budget.timeMs) return unknown(0, 'time-budget');

    // A macrotask yields to input/paint even when callers immediately await us.
    await pause();
    checkAbort(budget.signal);
    const root = physical(engineState(state));
    const rootKey = key(root);
    const seen = new Set([rootKey]);
    const stack = [{ state: root, moves: null, next: 0, via: null }];
    let visited = 1;
    let lastYield = now();
    let sinceYield = 0;
    while (stack.length) {
      checkAbort(budget.signal);
      if (now() >= deadline) return unknown(visited, 'time-budget');
      if (sinceYield >= 64 || now() - lastYield >= 6) {
        await pause();
        checkAbort(budget.signal);
        lastYield = now();
        sinceYield = 0;
        if (lastYield >= deadline) return unknown(visited, 'time-budget');
      }
      const frame = stack[stack.length - 1];
      if (!frame.moves) frame.moves = movesFrom(frame.state);
      if (frame.next === frame.moves.length) {
        stack.pop();
        continue;
      }
      const move = frame.moves[frame.next++];
      const next = transfer(frame.state, move);
      const signature = key(next);
      if (seen.has(signature) || dead.has(signature)) continue;
      if (visited >= budget.maxNodes) return unknown(visited, 'node-budget');
      seen.add(signature);
      visited += 1;
      sinceYield += 1;

      const certificate = certificateFor(next, signature);
      if (solved(next) || certificate) {
        const path = [...stack.slice(1).map((item) => item.via), { from: move.from, to: move.to },
          ...(certificate ? mappedSuffix(certificate, next) : [])];
        const frames = replay(state, path, budget.signal, deadline);
        if (frames) {
          remember(frames, path);
          return { status: 'solvable', moves: path, visited, reason: 'verified-search' };
        }
        // A failed engine verification is never promoted to a dead proof.
        return unknown(visited, now() >= deadline ? 'time-budget' : 'verification-failed');
      }
      stack.push({ state: next, moves: null, next: 0, via: { from: move.from, to: move.to } });
    }
    // All moves were considered; only equal-rod permutations were collapsed.
    // Every visited state is reachable from the root and cannot reach a win.
    for (const signature of seen) {
      dead.add(signature);
      if (dead.size > 12000) dead.delete(dead.values().next().value);
    }
    return { status: 'dead', visited, reason: 'exhausted' };
  }

  async function recover(state, options = {}) {
    const budget = limits(options);
    checkAbort(budget.signal);
    if (!state || !Array.isArray(state.history) || !state.history.length) {
      return { status: 'unavailable', visited: 0, reason: 'no-history' };
    }
    const deadline = now() + budget.timeMs;
    const candidates = [];
    let fallback = null;
    let uncertain = false;
    let lastYield = now();
    // Locate a certified fallback before spending the shared search budget.
    // These are real history frames, including their original fog mask/cursor.
    for (let index = state.history.length - 1; index >= 0; index -= 1) {
      checkAbort(budget.signal);
      if (now() - lastYield >= 6) {
        await pause();
        checkAbort(budget.signal);
        lastYield = now();
      }
      const snapshot = state.history[index];
      if (!snapshot || typeof snapshot !== 'object') { uncertain = true; continue; }
      const candidate = { ...snapshot, mode: snapshot.mode ?? modeOf(state),
        capacity: snapshot.capacity ?? state.capacity, history: [] };
      const result = known(candidate, budget.signal);
      if (result?.status === 'solvable' || result?.status === 'solved') {
        fallback = { index, analysis: result };
        break;
      }
      if (!result) candidates.push({ index, state: candidate });
      else if (result.status === 'unknown') uncertain = true;
    }
    let visited = 0;
    for (const candidate of candidates) {
      checkAbort(budget.signal);
      if (visited >= budget.maxNodes || now() >= deadline) { uncertain = true; break; }
      const analysis = await analyze(candidate.state, {
        maxNodes: budget.maxNodes - visited, timeMs: Math.max(0, deadline - now()), signal: budget.signal
      });
      visited += analysis.visited;
      if (analysis.status === 'solvable' || analysis.status === 'solved') {
        fallback = { index: candidate.index, analysis };
        break;
      }
      if (analysis.status === 'unknown') uncertain = true;
    }
    if (fallback) {
      const snapshot = state.history[fallback.index];
      const restored = { ...copy(snapshot), mode: snapshot.mode ?? modeOf(state),
        capacity: snapshot.capacity ?? state.capacity, history: copy(state.history.slice(0, fallback.index)) };
      return { status: 'found', state: restored, steps: state.history.length - fallback.index,
        analysis: fallback.analysis, visited };
    }
    return { status: uncertain ? 'unknown' : 'unavailable', visited,
      reason: uncertain ? 'unproved-history' : 'no-solvable-history' };
  }

  return { analyze, recover };
}
