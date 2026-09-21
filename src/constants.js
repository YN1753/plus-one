export const ROWS = 5;
export const COLS = 5;
export const MAX_ENERGY = 5;
export const MERGE_MIN = 3;
export const SCORE_FACTOR = 20;
export const MAX_CHAIN_GUARD = 64;

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
