export const ROWS = 5;
export const COLS = 5;
export const MAX_ENERGY = 5;
export const MERGE_MIN = 3;
export const SCORE_FACTOR = 20;
/** 单次点击后允许的 AUTO 连锁合成次数上限（不含点击那次） */
export const MAX_CHAIN_GUARD = 5;

/** 开局更散、补块少扎堆；weightExp 越小越接近均匀 */
export const DEFAULT_SPAWN = Object.freeze({
  floor: 4,
  decay: 2,
  weightExp: 0.55,
  initialUpper: 4,
  /** 同一波重力补块里，同一数值的软上限 */
  maxSamePerWave: 2,
});

export const STATE = Object.freeze({
  IDLE: 'IDLE',
  USER_ACTION: 'USER_ACTION',
  MERGE: 'MERGE',
  GRAVITY: 'GRAVITY',
  AUTO_CHECK: 'AUTO_CHECK',
  GAME_OVER: 'GAME_OVER',
});

export const DIRS = Object.freeze([
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]);
