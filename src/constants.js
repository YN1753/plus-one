export const ROWS = 5;
export const COLS = 5;
export const MAX_ENERGY = 5;
export const MERGE_MIN = 3;
export const SCORE_FACTOR = 20;
export const MAX_CHAIN_GUARD = 64;

/** 开局更散、少「随便点就爆分」：生成下限抬高、衰减更缓、倒加权更平 */
export const DEFAULT_SPAWN = Object.freeze({
  floor: 4,
  decay: 2,
  weightExp: 0.75,
  initialUpper: 4,
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
