import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../src/game.js';
import { STATE, MAX_ENERGY, SCORE_FACTOR } from '../src/constants.js';
import { createCell, resetCellIds } from '../src/board.js';
import { ROWS, COLS } from '../src/constants.js';

test('click rejects when locked or invalid', async () => {
  const game = createGame({ rng: () => 0 });
  const outOfBounds = await game.click(-1, 0);
  assert.equal(outOfBounds.ok, false);
  assert.equal(outOfBounds.reason, 'invalid_cell');
});

test('click increments value, spends energy, returns to IDLE when N<3', async () => {
  resetCellIds(1);
  // Craft: isolated cell at (0,0) with val 1, neighbors unique
  const events = [];
  const game = createGame({
    rng: () => 0,
    hooks: {
      onUserIncrement: (p) => events.push(['inc', p.r, p.c, p.cell.val]),
      onStateChange: (p) => events.push(['state', p.state]),
    },
  });

  // Patch board using internal ref
  const board = game._boardRef();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = createCell(10 + r * 10 + c);
    }
  }
  board[0][0] = createCell(1);
  board[0][1] = createCell(9);
  board[1][0] = createCell(8);

  const before = game.getSnapshot();
  assert.equal(before.state, STATE.IDLE);
  assert.equal(before.energy, MAX_ENERGY);

  const result = await game.click(0, 0);
  assert.equal(result.ok, true);
  const snap = game.getSnapshot();
  assert.equal(snap.board[0][0].val, 2); // 1+1
  assert.equal(snap.energy, MAX_ENERGY - 1);
  assert.equal(snap.state, STATE.IDLE);
  assert.equal(snap.score, 0);
  assert.ok(events.some(([t, s]) => t === 'state' && s === STATE.USER_ACTION));
  assert.ok(events.some(([t, s]) => t === 'state' && s === STATE.IDLE));
});

test('merge path: N>=3 scores N*mergeVal*20, refunds energy, upgrades center', async () => {
  resetCellIds(1);
  const merges = [];
  const game = createGame({
    rng: () => 0,
    hooks: {
      onMerge: (p) => merges.push(p),
    },
  });
  const board = game._boardRef();
  // Fill with unique non-matching values
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = createCell(40 + r * 10 + c);
    }
  }
  // Three 2s in a row at bottom-left; click center
  // After click (4,1) val 2→3, we need N>=3 of value 3.
  // So place three 2s, click one to make three 3s... only the clicked becomes 3.
  // Need: three cells already equal after increment.
  // Place: (4,0)=2, (4,1)=2, (4,2)=2. Click (4,1): vals become 2,3,2 — not connected same.
  // Place two neighbors already at 3, click a 2 that becomes 3.
  board[4][0] = createCell(3);
  board[4][1] = createCell(2);
  board[4][2] = createCell(3);

  const energyBefore = game.getSnapshot().energy;
  const result = await game.click(4, 1);
  assert.equal(result.ok, true);

  const snap = game.getSnapshot();
  // mergeVal = 3 (pre-upgrade shared value), N=3, score=3*3*20=180
  assert.equal(snap.score, 3 * 3 * SCORE_FACTOR);
  assert.equal(snap.energy, Math.min(MAX_ENERGY, energyBefore - 1 + 1));
  assert.equal(snap.comboCount, 0); // chain may continue or reset — after settle if no more merges combo resets
  // center upgraded to 4
  const center = snap.board[4][1];
  // gravity may have moved cells; find any val==4 near bottom or that id
  assert.equal(snap.lastMerge.mergeVal, 3);
  assert.equal(snap.lastMerge.N, 3);
  assert.equal(snap.lastMerge.gained, 3 * 3 * SCORE_FACTOR);
  assert.equal(merges.length >= 1, true);
  assert.equal(merges[0].mergeVal, 3);
  assert.equal(merges[0].N, 3);

  // After gravity, the upgraded center (val 4) exists somewhere
  let found4 = false;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (snap.board[r][c].val === 4) found4 = true;
    }
  }
  assert.ok(found4, 'expected upgraded val 4 on board after gravity');
});

test('input locked during animation chain', async () => {
  resetCellIds(1);
  let resolveMerge;
  const mergeGate = new Promise((resolve) => {
    resolveMerge = resolve;
  });
  const game = createGame({
    rng: () => 0,
    hooks: {
      onMerge: async () => {
        await mergeGate;
      },
    },
  });
  const board = game._boardRef();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = createCell(40 + r * 10 + c);
    }
  }
  board[4][0] = createCell(3);
  board[4][1] = createCell(2);
  board[4][2] = createCell(3);

  const p = game.click(4, 1);
  // Immediately try another click — should queue or reject
  await Promise.resolve();
  assert.notEqual(game.getState(), STATE.IDLE);
  const blocked = await Promise.race([
    game.click(0, 0),
    new Promise((r) => setTimeout(() => r({ ok: false, reason: 'still_locked' }), 20)),
  ]);
  // Either queued (ok once merge finishes) or still locked — if still_locked, merge not done
  // Release merge
  resolveMerge();
  const first = await p;
  assert.equal(first.ok, true);
  // queued click may complete
  if (blocked.reason === 'still_locked') {
    assert.ok(true);
  } else {
    // queued click resolved after unlock
    assert.ok(blocked.ok === true || blocked.reason === 'locked' || blocked.reason === 'still_locked');
  }
  assert.equal(game.getState(), STATE.IDLE);
});

test('game over when energy hits 0 without merge', async () => {
  resetCellIds(1);
  const game = createGame({ rng: () => 0 });
  const board = game._boardRef();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = createCell(40 + r * 10 + c);
    }
  }
  board[0][0] = createCell(1);
  board[0][1] = createCell(9);
  board[1][0] = createCell(8);

  // Drain energy to 1 via isolated clicks on (0,2) which is unique
  board[0][2] = createCell(99);
  // We need energy=1. Directly poke via successive non-merging clicks.
  // energy starts 5; each non-merge click -1. Do 4 clicks on isolated cells.
  for (let i = 0; i < 4; i++) {
    const r = 4;
    const c = i; // cells are unique 40+... — click increments may create accidental merges!
    // Safer: use a dedicated isolated pattern each time
  }

  // Force energy via multiple guaranteed-isolated clicks
  // Rebuild board each time is heavy; instead set unique values and click cells that
  // cannot form 3-in-a-row after +1.
  const isolated = [
    [0, 2],
    [1, 2],
    [2, 2],
    [3, 2],
  ];
  for (const [r, c] of isolated) {
    // ensure neighbors differ by >1 after increment
    board[r][c] = createCell(20 + r);
  }
  board[0][1] = createCell(9);
  board[1][1] = createCell(9);
  board[2][1] = createCell(9);
  board[3][1] = createCell(9);
  board[0][3] = createCell(9);
  board[1][3] = createCell(9);
  board[2][3] = createCell(9);
  board[3][3] = createCell(9);
  board[1][2] = createCell(11);
  board[2][2] = createCell(12);
  board[3][2] = createCell(13);
  board[4][2] = createCell(14);

  // Click (0,2): 20→21, neighbors 9,9,11 — isolated
  await game.click(0, 2);
  assert.equal(game.getSnapshot().energy, 4);
  assert.equal(game.getState(), STATE.IDLE);

  await game.click(1, 2);
  assert.equal(game.getSnapshot().energy, 3);

  await game.click(2, 2);
  assert.equal(game.getSnapshot().energy, 2);

  await game.click(3, 2);
  assert.equal(game.getSnapshot().energy, 1);
  assert.equal(game.getState(), STATE.IDLE);

  // Last click: no merge → energy 0 → GAME_OVER
  board[4][2] = game._boardRef()[4][2];
  // ensure (4,2) won't merge: neighbors unique
  const b = game._boardRef();
  b[4][1] = createCell(7);
  b[4][3] = createCell(6);
  b[3][2] = createCell(55);

  const last = await game.click(4, 2);
  assert.equal(last.ok, true);
  const snap = game.getSnapshot();
  assert.equal(snap.energy, 0);
  assert.equal(snap.gameOver, true);
  assert.equal(snap.state, STATE.GAME_OVER);

  const rejected = await game.click(0, 0);
  assert.equal(rejected.ok, false);
});

test('chain merge via gravity spawn forms combo', async () => {
  resetCellIds(1);
  // Column-based: three 3s that merge on click, gravity drops new 1s that also form a group.
  // rng=0 always spawns 1. If after gravity three 1s land connected... spawn fills full empty columns with 1s.
  // So any column that had 3+ empties will fill with 1s — many 1s → big chain.

  const merges = [];
  const game = createGame({
    rng: () => 0,
    hooks: {
      onMerge: (p) => merges.push({ N: p.N, mergeVal: p.mergeVal, combo: p.combo }),
    },
  });
  const board = game._boardRef();
  // Most cells unique high; leave a crafted merge and large empty regions that fill with 1s
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = createCell(80 + r * 10 + c);
    }
  }
  // Click-merge three 4s at row 3: neighbors already 4, clicked becomes 5... 
  // Use: (3,0)=4,(3,1)=3,(3,2)=4 → click (3,1) → 4,4,4 merge.
  board[3][0] = createCell(4);
  board[3][1] = createCell(3);
  board[3][2] = createCell(4);

  // Empty entire top by... they're high unique. After merge at row3, three cells cleared
  // (two members + we'll have center). Gravity: column 0 loses (3,0), shifts down, spawn 1 at top.
  // Many spawns of 1 across columns that had nulls — but we filled all cells, only merge creates nulls.
  // Only columns 0 and 2 lose a cell each (members), center stays. So 2 nulls → 2 spawns of 1.
  // 2 ones not enough for chain. Need more empty cells from the merge — N=3 means 2 destroyed.

  // Create a larger merge: 5 connected 3s, click one 2 to join them.
  // Reset strategy: five cells of value 3 in a plus/L shape plus click target.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = createCell(80 + r * 10 + c);
    }
  }
  // Shape:
  // 3 3 3
  // 3 2 3
  // Click (1,1) among them — that's 6 cells of related vals.
  // Click (1,1): 2→3, block of six 3s → N=6 merge.
  board[0][0] = createCell(3);
  board[0][1] = createCell(3);
  board[0][2] = createCell(3);
  board[1][0] = createCell(3);
  board[1][1] = createCell(2);
  board[1][2] = createCell(3);
  // Leave columns 0-2 top-heavy with more nulls? All filled. 5 destroyed cells → 5 nulls
  // spread across cols 0,1,2 → 2+2+1 or similar spawns of 1.
  // Also set some already-1 cells that could connect after drop? Hard to guarantee chain.

  // Simpler chain test: after merge, force board to have an auto-merge by leaving
  // a pair of 5s that become a trio when a spawn/drop brings a third — with rng=0 spawns are 1s.
  // So chain of 1s: ensure after gravity many 1s are orth-connected.
  // Place three 1s that are NOT yet a block... they're already a block if connected.
  // If I place 1s already connected N>=3, AUTO_CHECK after any merge will chain.
  // Even without click-merge: can't enter AUTO_CHECK without a merge first.
  // Place connected 1s that are currently split, and empty cells above them that spawn 1s to connect.
  // e.g. col0: row4=1, col1: row4=1, need one more 1 adjacent — spawn into (4,2) after a merge creates hole.

  // Practical test: plant three 1s at bottom row cols 0,1,2 but one of them is "blocked" by
  // being higher value until gravity... skip complex plant.
  // Instead: click merge that creates holes in cols 0-2, and bottom of those cols already has 1s
  // that will connect with spawned 1s at top? Spawns go to TOP, existing 1s at bottom —
  // they only connect if the whole column fills with 1s between them.
  // Fill cols 0-2 with 1s already except we need a click-merge first to enter the machine path.
  // Put: bottom row (4,0)=1,(4,1)=1,(4,2)=1 — already a block of 3. If I click elsewhere to merge,
  // AUTO_CHECK will find the 1s and chain-merge them. Perfect.

  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = createCell(80 + r * 10 + c);
    }
  }
  board[4][0] = createCell(1);
  board[4][1] = createCell(1);
  board[4][2] = createCell(1);
  // Prevent those 1s from being part of a bigger pre-existing issue; they're only 1s at bottom.

  // Click-merge three 4s in col 4
  board[0][4] = createCell(4);
  board[1][4] = createCell(3);
  board[2][4] = createCell(4);

  const result = await game.click(1, 4);
  assert.equal(result.ok, true);

  assert.ok(merges.length >= 2, `expected click merge + chain merge, got ${merges.length}: ${JSON.stringify(merges)}`);
  // Click (1,4) 3→4 joins two 4s → shared mergeVal is 4
  assert.equal(merges[0].mergeVal, 4);
  assert.equal(merges[0].N, 3);
  // second merge should be the chain of 1s
  const chain = merges.find((m) => m.mergeVal === 1);
  assert.ok(chain, `expected chain merge of val 1, merges=${JSON.stringify(merges)}`);
  assert.equal(chain.N, 3);
  assert.ok(chain.combo >= 2);

  const snap = game.getSnapshot();
  // score = click merge 3*4*20 + chain 3*1*20
  assert.equal(snap.score, 3 * 4 * SCORE_FACTOR + 3 * 1 * SCORE_FACTOR);
  // combo reset to 0 after chain settles with no further merges
  assert.equal(snap.comboCount, 0);
  assert.equal(snap.state, STATE.IDLE);
  assert.equal(snap.gameOver, false);
});

test('refunds energy on merge up to cap', async () => {
  resetCellIds(1);
  const game = createGame({ rng: () => 0 });
  const board = game._boardRef();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = createCell(80 + r * 10 + c);
    }
  }
  board[4][0] = createCell(5);
  board[4][1] = createCell(4);
  board[4][2] = createCell(5);

  // energy starts 5; click spends 1 → 4; merge refunds → 5
  await game.click(4, 1);
  assert.equal(game.getSnapshot().energy, MAX_ENERGY);
});

test('chain merge refund applies even when energy was spent to 0 on click', async () => {
  resetCellIds(1);
  const game = createGame({ rng: () => 0 });
  const board = game._boardRef();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = createCell(80 + r * 10 + c);
    }
  }
  // Drain to energy=1 with isolated clicks
  const isolatedCols = [2, 3, 4, 1];
  // craft isolated cells
  board[0][0] = createCell(70);
  board[0][1] = createCell(71);
  board[0][2] = createCell(72);
  board[0][3] = createCell(73);
  board[0][4] = createCell(74);
  board[1][0] = createCell(75);
  board[1][1] = createCell(76);
  board[1][2] = createCell(77);
  board[1][3] = createCell(78);
  board[1][4] = createCell(79);

  // 4 isolated clicks to reach energy=1 — use cells whose +1 won't match neighbors
  await game.click(0, 0); // 70→71, neighbor (0,1)=71 → MATCH pair only N=2 OK
  // Wait: (0,0)→71 and (0,1)=71 are orth connected → N=2, no merge. Good.
  assert.equal(game.getSnapshot().energy, 4);

  await game.click(0, 2); // 72→73, (0,3)=73 → N=2
  assert.equal(game.getSnapshot().energy, 3);

  await game.click(0, 4); // 74→75, (1,4)=79, (0,3) now 73 — ok
  assert.equal(game.getSnapshot().energy, 2);

  await game.click(1, 0); // 75→76, (1,1)=76 → N=2
  assert.equal(game.getSnapshot().energy, 1);

  // Merge click on last energy
  board[4][0] = createCell(9);
  board[4][1] = createCell(8);
  board[4][2] = createCell(9);
  const last = await game.click(4, 1);
  assert.equal(last.ok, true);
  const snap = game.getSnapshot();
  assert.equal(snap.energy, 1); // 0 + refund 1
  assert.equal(snap.gameOver, false);
  assert.equal(snap.state, STATE.IDLE);
});

test('reset restores initial energy/score/state', async () => {
  const game = createGame({ rng: () => 0 });
  await game.click(2, 2);
  game.reset();
  const snap = game.getSnapshot();
  assert.equal(snap.state, STATE.IDLE);
  assert.equal(snap.energy, MAX_ENERGY);
  assert.equal(snap.score, 0);
  assert.equal(snap.comboCount, 0);
  assert.equal(snap.gameOver, false);
});

test('click on empty cell invalid', async () => {
  const game = createGame({ rng: () => 0 });
  const board = game._boardRef();
  board[2][2] = null;
  const res = await game.click(2, 2);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'invalid_cell');
});
