export { ROWS, COLS, MAX_ENERGY, MERGE_MIN, SCORE_FACTOR, STATE, DIRS, MAX_CHAIN_GUARD } from './constants.js';
export {
  bfsBlock,
  cloneBoard,
  computeGravity,
  createBoardFilled,
  createCell,
  createEmptyBoard,
  fillEmptySpawn,
  findMaxMin,
  pickAutoMerge,
  pickChainCenter,
  resetCellIds,
  spawnUpper,
  spawnValue,
  applyMerge,
} from './board.js';
export { createGame } from './game.js';
