import {
  COLS,
  MAX_CHAIN_GUARD,
  MAX_ENERGY,
  MERGE_MIN,
  ROWS,
  SCORE_FACTOR,
  STATE,
} from './constants.js';
import {
  applyMerge,
  bfsBlock,
  cloneBoard,
  computeGravity,
  createBoardFilled,
  inBounds,
  normalizeSpawnOpts,
  pickAutoMerge,
} from './board.js';

function resolveHook(hooks, name, payload) {
  const fn = hooks?.[name];
  if (typeof fn !== 'function') return Promise.resolve();
  try {
    const result = fn(payload);
    if (result && typeof result.then === 'function') return result;
    return Promise.resolve(result);
  } catch (err) {
    return Promise.reject(err);
  }
}

function defaultRng() {
  return Math.random();
}

/**
 * Create a deadlock-free finite-state-machine game controller.
 *
 * @param {object} [options]
 * @param {() => number} [options.rng]
 * @param {object} [options.hooks] animation callbacks; must resolve when done
 * @param {number} [options.maxChainGuard]
 * @param {number} [options.spawnFloor] min spawn upper (default 4)
 * @param {number} [options.spawnDecay] MaxVal - decay (default 2)
 * @param {number} [options.spawnWeightExp] inverse-weight exponent (default 0.75)
 * @param {number} [options.initialUpper] opening bag upper (default 4)
 */
export function createGame(options = {}) {
  const rng = options.rng ?? defaultRng;
  const hooks = options.hooks ?? {};
  const maxChainGuard = options.maxChainGuard ?? MAX_CHAIN_GUARD;
  const spawnOpts = normalizeSpawnOpts({
    floor: options.spawnFloor,
    decay: options.spawnDecay,
    weightExp: options.spawnWeightExp,
    initialUpper: options.initialUpper,
  });

  let state = STATE.IDLE;
  let board = createBoardFilled(rng, spawnOpts);
  let energy = MAX_ENERGY;
  let score = 0;
  let comboCount = 0;
  let lastMerge = null;
  let lastGravity = null;
  let gameOver = false;
  let degraded = false;
  let chainDepth = 0;
  /** @type {Set<(snap: object) => void>} */
  const subscribers = new Set();
  /** @type {Promise|null} */
  let loop = null;

  function snapshot() {
    return {
      state,
      board: cloneBoard(board),
      energy,
      score,
      comboCount,
      lastMerge: lastMerge ? { ...lastMerge } : null,
      lastGravity: lastGravity
        ? {
            moves: lastGravity.moves.map((m) => ({ ...m })),
            spawns: lastGravity.spawns.map((s) => ({ ...s })),
          }
        : null,
      gameOver,
      degraded,
    };
  }

  function emit() {
    const snap = snapshot();
    for (const fn of subscribers) {
      try {
        fn(snap);
      } catch {
        /* subscriber errors must not deadlock FSM */
      }
    }
    resolveHook(hooks, 'onSnapshot', snap);
  }

  function setState(next, snapOverride) {
    state = next;
    const snap = snapOverride ?? snapshot();
    resolveHook(hooks, 'onStateChange', { state: next, snapshot: snap });
  }

  async function enterGameOver() {
    gameOver = true;
    setState(STATE.GAME_OVER);
    const snap = snapshot();
    emit();
    await resolveHook(hooks, 'onGameOver', snap);
  }

  async function runMerge(centerRC, blockCells, trigger) {
    setState(STATE.MERGE);
    const result = applyMerge(board, blockCells, centerRC);
    if (!result) {
      // Defensive: should not happen; recover to AUTO_CHECK
      setState(STATE.AUTO_CHECK);
      return;
    }

    energy = Math.min(MAX_ENERGY, energy + 1);
    score += result.N * result.mergeVal * SCORE_FACTOR;
    comboCount += 1;
    lastMerge = {
      center: result.center,
      N: result.N,
      mergeVal: result.mergeVal,
      gained: result.N * result.mergeVal * SCORE_FACTOR,
      combo: comboCount,
      trigger,
    };

    const payload = {
      center: result.center,
      members: result.members,
      mergeVal: result.mergeVal,
      N: result.N,
      energy,
      score,
      combo: comboCount,
      snapshot: snapshot(),
    };
    emit();
    await resolveHook(hooks, 'onMerge', payload);
    setState(STATE.GRAVITY);
    await runGravity();
  }

  async function runGravity() {
    const { board: next, moves, spawns } = computeGravity(board, rng, spawnOpts);
    board = next;
    lastGravity = { moves, spawns };
    emit();
    await resolveHook(hooks, 'onGravity', {
      moves,
      spawns,
      snapshot: snapshot(),
    });
    setState(STATE.AUTO_CHECK);
    await runAutoCheck();
  }

  async function runAutoCheck() {
    chainDepth += 1;
    if (chainDepth > maxChainGuard) {
      degraded = true;
      comboCount = 0;
      if (energy === 0) await enterGameOver();
      else {
        setState(STATE.IDLE);
        emit();
      }
      return;
    }

    const found = pickAutoMerge(board);
    if (found) {
      await runMerge(found.center, found.cells, 'chain');
      return;
    }

    comboCount = 0;
    if (energy === 0) {
      await enterGameOver();
      return;
    }
    setState(STATE.IDLE);
    emit();
  }

  /**
   * Player click. Only accepted in IDLE with energy > 0.
   * Non-IDLE states reject immediately with `locked` (no input queue).
   * @returns {Promise<{ok:boolean, reason?:string, snapshot:object}>}
   */
  function handleClick(r, c) {
    if (state !== STATE.IDLE) {
      return Promise.resolve({ ok: false, reason: 'locked', snapshot: snapshot() });
    }
    if (gameOver) {
      return Promise.resolve({ ok: false, reason: 'game_over', snapshot: snapshot() });
    }
    if (energy <= 0) {
      return Promise.resolve({ ok: false, reason: 'no_energy', snapshot: snapshot() });
    }
    if (!inBounds(r, c) || !board[r][c]) {
      return Promise.resolve({ ok: false, reason: 'invalid_cell', snapshot: snapshot() });
    }

    chainDepth = 0;
    lastMerge = null;
    lastGravity = null;

    // USER_ACTION
    setState(STATE.USER_ACTION);
    const cell = board[r][c];
    cell.val += 1;
    energy -= 1;
    emit();
    resolveHook(hooks, 'onUserIncrement', {
      r,
      c,
      cell: { ...cell },
      snapshot: snapshot(),
    });

    const { cells } = bfsBlock(board, r, c);
    const N = cells.length;

    // Run remaining FSM asynchronously; click promise resolves when chain settles or locks.
    const runPromise = (async () => {
      if (N >= MERGE_MIN) {
        await runMerge({ r, c }, cells, 'click');
      } else if (energy === 0) {
        await enterGameOver();
      } else {
        setState(STATE.IDLE);
        emit();
      }
      return { ok: true, N, snapshot: snapshot() };
    })();

    // Keep internal loop reference for debugging / future cancel
    loop = runPromise.catch((err) => {
      // hooks must not deadlock — on hook failure, force safe state
      degraded = true;
      if (energy === 0) {
        gameOver = true;
        state = STATE.GAME_OVER;
      } else {
        state = STATE.IDLE;
      }
      emit();
      return { ok: false, reason: 'hook_error', error: String(err), snapshot: snapshot() };
    });

    return loop;
  }

  function click(r, c) {
    // S2.6 rule 1: only IDLE accepts clicks; otherwise immediate {ok:false, reason:'locked'}
    return handleClick(r, c);
  }

  function reset() {
    state = STATE.IDLE;
    board = createBoardFilled(rng, spawnOpts);
    energy = MAX_ENERGY;
    score = 0;
    comboCount = 0;
    lastMerge = null;
    lastGravity = null;
    gameOver = false;
    degraded = false;
    chainDepth = 0;
    loop = null;
    emit();
  }

  function subscribe(fn) {
    subscribers.add(fn);
    return () => subscribers.delete(fn);
  }

  return {
    click,
    reset,
    subscribe,
    getSnapshot: snapshot,
    getState: () => state,
    getBoard: () => cloneBoard(board),
    /** Raw board reference for tests that need identity — prefer getBoard. */
    _boardRef: () => board,
    _internal: () => ({ state, energy, score, comboCount, chainDepth, gameOver, degraded }),
  };
}

export { ROWS, COLS, STATE };
