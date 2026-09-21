import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bfsBlock,
  pickChainCenter,
  pickAutoMerge,
  spawnUpper,
  spawnValue,
  computeGravity,
  createCell,
  createEmptyBoard,
  fillEmptySpawn,
  findMaxMin,
  applyMerge,
  resetCellIds,
} from '../src/board.js';
import { ROWS, COLS, MERGE_MIN } from '../src/constants.js';

function setBoard(spec) {
  // spec: array of rows, each row array of val | null
  const board = createEmptyBoard();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const v = spec[r][c];
      board[r][c] = v === null || v === undefined ? null : createCell(v);
    }
  }
  return board;
}

test('spawnUpper: harder opening — floor 4, decay 2', () => {
  assert.equal(spawnUpper(null), 4);
  assert.equal(spawnUpper(2), 4);
  assert.equal(spawnUpper(5), 4);
  assert.equal(spawnUpper(6), 4);
  assert.equal(spawnUpper(7), 5);
  assert.equal(spawnUpper(10), 8);
  // legacy softer? explicit opts can raise floor further
  assert.equal(spawnUpper(3, { floor: 5 }), 5);
});

test('spawnValue inverse-weight: low values more frequent', () => {
  const upper = spawnUpper(10); // 8
  const counts = new Map();
  const n = 7000;
  let s = 42;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  for (let i = 0; i < n; i++) {
    const v = spawnValue(10, rng);
    assert.ok(v >= 1 && v <= upper);
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  assert.ok(counts.get(1) > counts.get(upper), `1 (${counts.get(1)}) should > ${upper} (${counts.get(upper)})`);
  assert.ok(counts.get(1) > counts.get(2));
  assert.ok(counts.get(2) > counts.get(3));
});

test('spawnValue rng=0 returns 1; rng near 1 returns upper', () => {
  assert.equal(spawnValue(10, () => 0), 1);
  assert.equal(spawnValue(10, () => 0.999999), spawnUpper(10));
});

test('bfsBlock: 4-connected only, no diagonal', () => {
  resetCellIds(1);
  const board = setBoard([
    [2, 9, 2, 8, 7],
    [9, 2, 8, 7, 6],
    [2, 8, 2, 7, 6],
    [8, 7, 6, 5, 4],
    [7, 6, 5, 4, 3],
  ]);
  // Diagonal 2s at (0,0),(0,2),(1,1),(2,0),(2,2) must NOT form one block.
  const { cells } = bfsBlock(board, 0, 0);
  assert.equal(cells.length, 1);
  const mid = bfsBlock(board, 1, 1);
  assert.equal(mid.cells.length, 1);
});

test('bfsBlock: orth connected group N>=3', () => {
  resetCellIds(1);
  const board = setBoard([
    [5, 5, 1, 9, 8],
    [5, 1, 1, 8, 7],
    [1, 1, 9, 7, 6],
    [8, 7, 6, 5, 4],
    [7, 6, 5, 4, 3],
  ]);
  const block5 = bfsBlock(board, 0, 0);
  assert.equal(block5.cells.length, 3);
  assert.ok(block5.cells.length >= MERGE_MIN);

  const block1 = bfsBlock(board, 0, 2);
  assert.equal(block1.cells.length, 5);
});

test('pickChainCenter: max row, col near mean', () => {
  const cells = [
    { r: 1, c: 0, cell: { id: 1, val: 3, isMerged: false } },
    { r: 2, c: 1, cell: { id: 2, val: 3, isMerged: false } },
    { r: 2, c: 2, cell: { id: 3, val: 3, isMerged: false } },
    { r: 2, c: 4, cell: { id: 4, val: 3, isMerged: false } },
  ];
  const center = pickChainCenter(cells);
  assert.equal(center.r, 2);
  // mean col = (0+1+2+4)/4 = 1.75 → closest among bottom is c=2 (dist 0.25) vs c=1 (0.75) vs c=4 (2.25)
  assert.equal(center.c, 2);
});

test('pickAutoMerge: prefers largest N, bottom center', () => {
  resetCellIds(1);
  const board = setBoard([
    [4, 4, 4, 1, 2],
    [1, 2, 3, 1, 2],
    [7, 7, 7, 7, 2],
    [1, 2, 3, 4, 5],
    [2, 3, 4, 5, 6],
  ]);
  const found = pickAutoMerge(board);
  assert.ok(found);
  assert.equal(found.cells.length, 4);
  assert.equal(found.val, 7);
  assert.equal(found.center.r, 2);
});

test('computeGravity: survivors sink, order preserved, spawns fill top', () => {
  resetCellIds(100);
  const board = setBoard([
    [null, 3, null, null, null],
    [2, 3, null, null, null],
    [2, null, null, null, null],
    [null, null, null, null, null],
    [null, null, null, null, null],
  ]);
  const { board: next, moves, spawns } = computeGravity(board, () => 0);

  // Column 0: 2,2 survive at rows 3,4; 3 nulls spawn at 0..2
  assert.equal(next[4][0].val, 2);
  assert.equal(next[3][0].val, 2);
  assert.equal(next[2][0].val, 1); // rng=0 → spawn 1
  assert.equal(next[1][0].val, 1);
  assert.equal(next[0][0].val, 1);

  // Column 1: 3,3 at bottom
  assert.equal(next[4][1].val, 3);
  assert.equal(next[3][1].val, 3);

  // Relative order: original row1 cell above original row2? 
  // Survivors collected bottom-up: row2 then row1 → write to row4 then row3
  // So cell that was at r=2 is at r=4; cell that was at r=1 is at r=3.
  // "Preserve relative order" means the piece that was lower stays lower.
  // Originally r=1 (upper 2) should end up above originally r=2 (lower 2).
  // After: r=3 is former r=1, r=4 is former r=2. Good.

  const col0Moves = moves.filter((m) => m.col === 0);
  const upper = col0Moves.find((m) => m.fromRow === 1);
  const lower = col0Moves.find((m) => m.fromRow === 2);
  assert.equal(upper.toRow, 3);
  assert.equal(lower.toRow, 4);
  assert.equal(lower.toRow - lower.fromRow, 2);
  assert.equal(lower.dropDistance, 2);
  assert.equal(upper.dropDistance, 2);

  const col0Spawns = spawns.filter((s) => s.col === 0);
  assert.equal(col0Spawns.length, 3);
  // Topmost empty cell starts highest (most negative spawnFromRow)
  const sorted = [...col0Spawns].sort((a, b) => a.row - b.row);
  assert.equal(sorted[0].spawnFromRow, -3);
  assert.equal(sorted[1].spawnFromRow, -2);
  assert.equal(sorted[2].spawnFromRow, -1);
  assert.ok(sorted[0].spawnFromRow < sorted[1].spawnFromRow);
  assert.ok(sorted[1].spawnFromRow < sorted[2].spawnFromRow);
});

test('computeGravity on full board: no spawns for solid columns', () => {
  const full = fillEmptySpawn(createEmptyBoard(), () => 0);
  const { spawns } = computeGravity(full, () => 0);
  assert.equal(spawns.length, 0);
});

test('findMaxMin on empty is null; opening bag uses [1,4] without ready triples', () => {
  const empty = createEmptyBoard();
  assert.deepEqual(findMaxMin(empty), { maxVal: null, minVal: null });

  // Multiple seeds: opening must not ship a ready N>=3 block
  for (let seed = 1; seed <= 20; seed++) {
    let s = seed * 9973 + 17;
    const rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const filled = fillEmptySpawn(createEmptyBoard(), rng);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        assert.ok(
          filled[r][c].val >= 1 && filled[r][c].val <= 4,
          `seed=${seed} val=${filled[r][c].val} out of [1,4]`
        );
      }
    }
    assert.equal(
      pickAutoMerge(filled),
      null,
      `seed=${seed} opening board should not contain a ready merge block`
    );
  }
});

test('opening difficulty: random clicks on a fresh board rarely merge immediately', () => {
  let merges = 0;
  const trials = 40;
  for (let seed = 100; seed < 100 + trials; seed++) {
    let s = seed * 9973 + 17;
    const rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const board = fillEmptySpawn(createEmptyBoard(), rng);
    // pick a random cell, apply +1, see if N>=3
    const r = Math.floor(rng() * ROWS);
    const c = Math.floor(rng() * COLS);
    board[r][c].val += 1;
    const { cells } = bfsBlock(board, r, c);
    if (cells.length >= MERGE_MIN) merges += 1;
  }
  // Opening is harder: majority of blind clicks should NOT score
  assert.ok(merges <= trials * 0.35, `blind-click merge rate too high: ${merges}/${trials}`);
});

test('applyMerge upgrades center, removes members, uses mergeVal', () => {
  resetCellIds(1);
  const board = setBoard([
    [3, 3, 3, null, null],
    [null, null, null, null, null],
    [null, null, null, null, null],
    [null, null, null, null, null],
    [null, null, null, null, null],
  ]);
  const { cells } = bfsBlock(board, 0, 1);
  const result = applyMerge(board, cells, { r: 0, c: 1 });
  assert.equal(result.mergeVal, 3);
  assert.equal(result.N, 3);
  assert.equal(result.center.val, 4);
  assert.equal(board[0][1].val, 4);
  assert.equal(board[0][0], null);
  assert.equal(board[0][2], null);
  assert.equal(board[0][1].isMerged, true);
  assert.equal(result.members.length, 2);
});
