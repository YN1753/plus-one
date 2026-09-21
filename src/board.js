import { COLS, ROWS, MERGE_MIN, DIRS } from './constants.js';

let nextCellId = 1;

export function resetCellIds(start = 1) {
  nextCellId = start;
}

export function createCell(val, isMerged = false) {
  return { id: nextCellId++, val, isMerged };
}

export function createEmptyBoard() {
  return Array.from({ length: ROWS }, () => Array.from({ length: COLS }, () => null));
}

export function cloneBoard(board) {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

export function inBounds(r, c) {
  return r >= 0 && r < ROWS && c >= 0 && c < COLS;
}

export function findMaxMin(board) {
  let maxVal = null;
  let minVal = null;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const cell = board[r][c];
      if (!cell) continue;
      if (maxVal === null || cell.val > maxVal) maxVal = cell.val;
      if (minVal === null || cell.val < minVal) minVal = cell.val;
    }
  }
  return { maxVal, minVal };
}

/**
 * Dynamic spawn upper bound.
 * @param {number|null} maxVal
 */
export function spawnUpper(maxVal) {
  if (maxVal === null || maxVal === undefined) return 3;
  return Math.max(3, maxVal - 3);
}

/**
 * Inverse-weighted spawn: smaller values are more probable.
 * weight(v) = 1 / v
 * @param {number|null} maxVal
 * @param {() => number} rng returns [0, 1)
 */
export function spawnValue(maxVal, rng = Math.random) {
  const upper = spawnUpper(maxVal);
  let total = 0;
  const weights = [];
  for (let v = 1; v <= upper; v++) {
    const w = 1 / v;
    weights.push(w);
    total += w;
  }
  let roll = rng() * total;
  for (let i = 0; i < weights.length; i++) {
    roll -= weights[i];
    if (roll < 0) return i + 1;
  }
  return upper;
}

/**
 * 4-connected BFS flood fill from (r,c) for equal values.
 * @returns {{cells: {r:number,c:number,cell:object}[], visited: boolean[][]}}
 */
export function bfsBlock(board, r, c) {
  const cells = [];
  const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  const start = board[r]?.[c];
  if (!start) return { cells, visited };

  const target = start.val;
  const queue = [{ r, c }];
  visited[r][c] = true;

  while (queue.length) {
    const cur = queue.shift();
    const cell = board[cur.r][cur.c];
    cells.push({ r: cur.r, c: cur.c, cell });
    for (const [dr, dc] of DIRS) {
      const nr = cur.r + dr;
      const nc = cur.c + dc;
      if (!inBounds(nr, nc) || visited[nr][nc]) continue;
      const nb = board[nr][nc];
      if (!nb || nb.val !== target) continue;
      visited[nr][nc] = true;
      queue.push({ r: nr, c: nc });
    }
  }
  return { cells, visited };
}

/**
 * Pick merge center for chain/auto merges:
 * max row; among them col closest to block mean col; ties → smaller col.
 */
export function pickChainCenter(cells) {
  if (!cells.length) return null;
  let maxRow = -Infinity;
  for (const { r } of cells) {
    if (r > maxRow) maxRow = r;
  }
  const bottom = cells.filter(({ r }) => r === maxRow);
  let meanCol = 0;
  for (const { c } of cells) meanCol += c;
  meanCol /= cells.length;

  let best = bottom[0];
  let bestDist = Math.abs(best.c - meanCol);
  for (const item of bottom.slice(1)) {
    const dist = Math.abs(item.c - meanCol);
    if (dist < bestDist - 1e-9 || (Math.abs(dist - bestDist) < 1e-9 && item.c < best.c)) {
      best = item;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * Global scan for any valid merge block (N >= 3).
 * Preference: largest N, then chain-center heuristics.
 */
export function pickAutoMerge(board) {
  const seen = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
  let best = null;
  let bestScore = null;

  for (let r = ROWS - 1; r >= 0; r--) {
    for (let c = 0; c < COLS; c++) {
      if (seen[r][c] || !board[r][c]) continue;
      const { cells } = bfsBlock(board, r, c);
      for (const item of cells) seen[item.r][item.c] = true;
      if (cells.length < MERGE_MIN) continue;

      const center = pickChainCenter(cells);
      let meanCol = 0;
      for (const { c: cc } of cells) meanCol += cc;
      meanCol /= cells.length;

      const key = {
        n: cells.length,
        centerRow: center.r,
        dist: Math.abs(center.c - meanCol),
        centerCol: center.c,
      };

      if (
        bestScore === null ||
        key.n > bestScore.n ||
        (key.n === bestScore.n && key.centerRow > bestScore.centerRow) ||
        (key.n === bestScore.n &&
          key.centerRow === bestScore.centerRow &&
          key.dist < bestScore.dist - 1e-9) ||
        (key.n === bestScore.n &&
          key.centerRow === bestScore.centerRow &&
          Math.abs(key.dist - bestScore.dist) < 1e-9 &&
          key.centerCol < bestScore.centerCol)
      ) {
        bestScore = key;
        best = { cells, center, val: board[center.r][center.c].val };
      }
    }
  }
  return best;
}

/**
 * Column-wise gravity: survivors sink; empty tops spawn via algorithm.
 * Mutates a working board copy internally and returns next board + animation data.
 */
export function computeGravity(board, rng = Math.random) {
  const next = cloneBoard(board);
  const moves = [];
  const spawns = [];

  for (let c = 0; c < COLS; c++) {
    const survivors = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      const cell = next[r][c];
      if (cell) survivors.push({ fromRow: r, cell });
    }

    // Clear column
    for (let r = 0; r < ROWS; r++) next[r][c] = null;

    // Sink survivors to bottom, preserving relative order
    let writeRow = ROWS - 1;
    for (const { fromRow, cell } of survivors) {
      cell.isMerged = false;
      next[writeRow][c] = cell;
      if (writeRow !== fromRow) {
        moves.push({
          id: cell.id,
          fromRow,
          toRow: writeRow,
          col: c,
          val: cell.val,
        });
      } else {
        moves.push({
          id: cell.id,
          fromRow,
          toRow: writeRow,
          col: c,
          val: cell.val,
        });
      }
      writeRow--;
    }

    // Fill remaining top empty cells
    const emptyCount = writeRow + 1;
    const { maxVal } = findMaxMin(next);
    // Use a local upper based on current column fill + existing board values
    // Spec: MaxVal of whole board. During column fill, recompute is fine.
    for (let i = 0; i < emptyCount; i++) {
      const row = writeRow - i;
      const val = spawnValue(maxVal, rng);
      const cell = createCell(val, false);
      next[row][c] = cell;
      // Falling stack above the board: lowest empty cell starts just above (row -1),
      // higher empty cells start higher up so they drop in as one column.
      // i=0 → lowest empty row; i=emptyCount-1 → topmost empty row
      const spawnFromRow = -1 - i;
      spawns.push({
        row,
        col: c,
        id: cell.id,
        val,
        spawnFromRow,
      });
    }
  }

  return { board: next, moves, spawns };
}

/**
 * Fill a fully empty board (or remaining nulls) using spawn algorithm.
 */
export function fillEmptySpawn(board, rng = Math.random) {
  const next = cloneBoard(board);
  const { maxVal } = findMaxMin(next);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (!next[r][c]) {
        next[r][c] = createCell(spawnValue(maxVal, rng), false);
      }
    }
  }
  return next;
}

/**
 * Apply merge in-place on a board copy.
 * Center keeps identity; members are destroyed; center.val upgrades.
 */
export function applyMerge(board, cells, centerRC) {
  const { r: cr, c: cc } = centerRC;
  const center = board[cr][cc];
  if (!center) return null;
  const mergeVal = center.val;
  const members = [];

  for (const { r, c, cell } of cells) {
    if (r === cr && c === cc) {
      cell.isMerged = true;
      continue;
    }
    members.push({ r, c, id: cell.id, val: cell.val });
    board[r][c] = null;
    cell.isMerged = true;
  }

  center.isMerged = true;
  center.val = mergeVal + 1;

  return {
    center: { r: cr, c: cc, id: center.id, val: center.val },
    members,
    mergeVal,
    N: cells.length,
  };
}

export function createBoardFilled(rng = Math.random) {
  return fillEmptySpawn(createEmptyBoard(), rng);
}
