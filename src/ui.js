import { createGame } from './game.js';
import { MAX_ENERGY, STATE } from './constants.js';

const boardEl = document.getElementById('board');
const scoreEl = document.getElementById('score');
const comboEl = document.getElementById('combo');
const energyEl = document.getElementById('energy');
const pipsEl = document.getElementById('pips');
const toastEl = document.getElementById('toast');
const flashEl = document.getElementById('flash');
const resetBtn = document.getElementById('resetBtn');

let tileEls = [];
let busy = false;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function colorFor(val) {
  const t = Math.min(1, (val - 1) / 10);
  const hue = 215 + t * 40;
  const sat = 35 + t * 25;
  const light = 28 + t * 18;
  return `hsl(${hue} ${sat}% ${light}%)`;
}

function ensureTiles() {
  if (tileEls.length === 25) return;
  boardEl.innerHTML = '';
  tileEls = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const el = document.createElement('div');
      el.className = 'tile';
      el.dataset.r = String(r);
      el.dataset.c = String(c);
      el.addEventListener('click', onTileClick);
      boardEl.appendChild(el);
      tileEls.push(el);
    }
  }
}

function renderBoard(board, opts = {}) {
  ensureTiles();
  const mergedIds = new Set(opts.mergedIds || []);
  const spawnedIds = new Set(opts.spawnedIds || []);
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const el = tileEls[r * 5 + c];
      const cell = board[r][c];
      if (!cell) {
        el.textContent = '';
        el.style.background = 'var(--tile)';
        el.classList.remove('merged', 'spawned');
        continue;
      }
      el.textContent = String(cell.val);
      el.style.background = mergedIds.has(cell.id) ? 'var(--accent)' : colorFor(cell.val);
      el.classList.toggle('merged', mergedIds.has(cell.id) || cell.isMerged);
      el.classList.toggle('spawned', spawnedIds.has(cell.id));
      el.classList.toggle('locked', busy);
    }
  }
}

function renderStats(snap) {
  scoreEl.textContent = String(snap.score);
  comboEl.textContent = String(snap.comboCount);
  energyEl.textContent = String(snap.energy);
  pipsEl.innerHTML = '';
  for (let i = 0; i < MAX_ENERGY; i++) {
    const pip = document.createElement('span');
    pip.className = 'pip' + (i < snap.energy ? ' on' : '');
    pipsEl.appendChild(pip);
  }
}

function setToast(text, over = false) {
  toastEl.textContent = text;
  toastEl.classList.toggle('over', over);
}

function flashCombo(combo) {
  if (combo < 2) return;
  flashEl.textContent = `COMBO ×${combo}`;
  flashEl.classList.remove('show');
  void flashEl.offsetWidth;
  flashEl.classList.add('show');
}

const game = createGame({
  hooks: {
    onSnapshot(snap) {
      renderStats(snap);
    },
    async onUserIncrement({ r, c, snapshot }) {
      renderBoard(snapshot.board);
      tileEls[r * 5 + c]?.classList.add('spawned');
      await delay(140);
    },
    async onMerge({ center, members, N, mergeVal, combo, snapshot }) {
      const mergedIds = [center.id, ...members.map((m) => m.id)];
      renderBoard(snapshot.board, { mergedIds });
      setToast(`合成 ${N} 个 ${mergeVal} → ${mergeVal + 1}  +${N * mergeVal * 20}`);
      flashCombo(combo);
      await delay(280);
    },
    async onGravity({ spawns, snapshot }) {
      renderBoard(snapshot.board, { spawnedIds: spawns.map((s) => s.id) });
      await delay(220);
    },
    async onGameOver(snapshot) {
      renderBoard(snapshot.board);
      setToast(`游戏结束 · 得分 ${snapshot.score}`, true);
      busy = false;
    },
  },
});

function paint() {
  const snap = game.getSnapshot();
  renderBoard(snap.board);
  renderStats(snap);
}

async function onTileClick(e) {
  if (busy) return;
  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);
  const state = game.getState();
  if (state !== STATE.IDLE) {
    setToast(state === STATE.GAME_OVER ? '已结束，请重新开始' : '结算中…');
    return;
  }
  busy = true;
  setToast('');
  try {
    const result = await game.click(r, c);
    if (!result.ok && result.reason === 'invalid_cell') {
      setToast('无效格子');
    } else if (!result.ok && result.reason === 'no_energy') {
      setToast('体力不足', true);
    } else if (!result.ok && result.reason === 'game_over') {
      setToast('游戏结束，请重新开始', true);
    } else if (!result.ok && result.reason === 'hook_error') {
      setToast('动画异常，已恢复', true);
    }
  } finally {
    busy = false;
    paint();
  }
}

resetBtn.addEventListener('click', () => {
  game.reset();
  busy = false;
  setToast('新的一局');
  paint();
});

paint();
