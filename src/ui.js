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
const overlayEl = document.getElementById('overlay');
const finalScoreEl = document.getElementById('finalScore');
const againBtn = document.getElementById('againBtn');

/** 釉色阶：与 index.html 的 --g1…--gmax 对应 */
const GLAZE = {
  1: { bg: 'var(--g1)', fg: 'var(--g1-fg)', ring: 'var(--g1-ring)' },
  2: { bg: 'var(--g2)', fg: 'var(--g2-fg)', ring: 'var(--g2-ring)' },
  3: { bg: 'var(--g3)', fg: 'var(--g3-fg)', ring: 'var(--g3-ring)' },
  4: { bg: 'var(--g4)', fg: 'var(--g4-fg)', ring: 'var(--g4-ring)' },
  5: { bg: 'var(--g5)', fg: 'var(--g5-fg)', ring: 'var(--g5-ring)' },
  6: { bg: 'var(--g6)', fg: 'var(--g6-fg)', ring: 'var(--g6-ring)' },
  7: { bg: 'var(--g7)', fg: 'var(--g7-fg)', ring: 'var(--g7-ring)' },
  8: { bg: 'var(--g8)', fg: 'var(--g8-fg)', ring: 'var(--g8-ring)' },
  9: { bg: 'var(--g9)', fg: 'var(--g9-fg)', ring: 'var(--g9-ring)' },
  10: { bg: 'var(--g10)', fg: 'var(--g10-fg)', ring: 'var(--g10-ring)' },
};

function glazeFor(val) {
  return GLAZE[val] ?? { bg: 'var(--gmax)', fg: 'var(--gmax-fg)', ring: 'var(--gmax-ring)' };
}

let tileEls = [];
let busy = false;
let lastScore = 0;

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function ensureTiles() {
  if (tileEls.length === 25) return;
  boardEl.innerHTML = '';
  tileEls = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'tile empty';
      el.dataset.r = String(r);
      el.dataset.c = String(c);
      el.setAttribute('role', 'gridcell');
      el.setAttribute('aria-label', `空格 ${r + 1} 行 ${c + 1} 列`);
      el.addEventListener('click', onTileClick);
      boardEl.appendChild(el);
      tileEls.push(el);
    }
  }
}

function applyGlaze(el, val, forceMerged = false) {
  const g = glazeFor(val);
  el.dataset.val = String(val);
  el.style.background = g.bg;
  el.style.color = g.fg;
  el.style.setProperty('--ring', g.ring);
  el.classList.remove('empty');
  if (forceMerged) {
    // center seal handled via .merged.center
  }
}

function clearTile(el) {
  el.textContent = '';
  delete el.dataset.val;
  el.style.background = '';
  el.style.color = '';
  el.style.removeProperty('--ring');
  el.classList.remove('merged', 'center', 'spawned', 'bump', 'empty');
  el.classList.add('empty');
  el.setAttribute('aria-label', `空格 ${Number(el.dataset.r) + 1} 行 ${Number(el.dataset.c) + 1} 列`);
}

function renderBoard(board, opts = {}) {
  ensureTiles();
  const mergedIds = new Set(opts.mergedIds || []);
  const spawnedIds = new Set(opts.spawnedIds || []);
  const centerId = opts.centerId ?? null;
  const bump = opts.bump ? `${opts.bump.r},${opts.bump.c}` : null;

  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      const el = tileEls[r * 5 + c];
      const cell = board[r][c];
      const key = `${r},${c}`;

      if (!cell) {
        clearTile(el);
        continue;
      }

      el.textContent = String(cell.val);
      applyGlaze(el, cell.val);
      el.setAttribute('aria-label', `数值 ${cell.val}`);

      const isMerged = mergedIds.has(cell.id) || cell.isMerged;
      const isCenter = centerId != null && cell.id === centerId;
      el.classList.toggle('merged', isMerged);
      el.classList.toggle('center', isCenter);
      el.classList.toggle('spawned', spawnedIds.has(cell.id));
      el.classList.toggle('bump', key === bump);
      el.classList.toggle('locked', busy);
    }
  }
}

function renderStats(snap) {
  scoreEl.textContent = String(snap.score);
  if (snap.score !== lastScore && lastScore !== 0) {
    scoreEl.animate?.(
      [
        { transform: 'scale(1)', color: 'var(--gold)' },
        { transform: 'scale(1.08)', color: 'var(--seal)' },
        { transform: 'scale(1)', color: 'var(--gold)' },
      ],
      { duration: 280, easing: 'ease-out' }
    );
  }
  lastScore = snap.score;

  comboEl.textContent = String(snap.comboCount);
  comboEl.classList.toggle('hot', snap.comboCount >= 2);

  energyEl.textContent = String(snap.energy);
  pipsEl.innerHTML = '';
  for (let i = 0; i < MAX_ENERGY; i++) {
    const pip = document.createElement('span');
    pip.className = 'pip' + (i < snap.energy ? ' on' : '');
    pipsEl.appendChild(pip);
  }
}

function setToast(text, kind = '') {
  toastEl.textContent = text;
  toastEl.classList.remove('success', 'over');
  if (kind) toastEl.classList.add(kind);
}

function showSeal(combo) {
  flashEl.innerHTML = `
    <div class="seal">
      <span class="en">COMBO</span>
      <span class="n">×${combo}</span>
      <span class="zh">连击</span>
    </div>
  `;
  flashEl.classList.remove('show');
  void flashEl.offsetWidth;
  flashEl.classList.add('show');
}

function showGameOver(score) {
  finalScoreEl.textContent = String(score);
  overlayEl.hidden = false;
  overlayEl.classList.add('show');
}

function hideGameOver() {
  overlayEl.classList.remove('show');
  overlayEl.hidden = true;
}

const game = createGame({
  hooks: {
    onSnapshot(snap) {
      renderStats(snap);
    },
    async onUserIncrement({ r, c, snapshot }) {
      renderBoard(snapshot.board, { bump: { r, c } });
      tileEls[r * 5 + c]?.classList.add('bump');
      await delay(160);
    },
    async onMerge({ center, members, N, mergeVal, combo, gained, snapshot }) {
      const mergedIds = [center.id, ...members.map((m) => m.id)];
      renderBoard(snapshot.board, {
        mergedIds,
        centerId: center.id,
      });
      setToast(`合成 ${N} × ${mergeVal} → ${mergeVal + 1}　+${gained ?? N * mergeVal * 20}`, 'success');
      if (combo >= 2) showSeal(combo);
      await delay(320);
    },
    async onGravity({ spawns, snapshot }) {
      renderBoard(snapshot.board, { spawnedIds: spawns.map((s) => s.id) });
      await delay(240);
    },
    async onGameOver(snapshot) {
      renderBoard(snapshot.board);
      setToast(`体力耗尽 · 得分 ${snapshot.score}`, 'over');
      showGameOver(snapshot.score);
      busy = false;
    },
  },
});

function paint() {
  const snap = game.getSnapshot();
  renderBoard(snap.board);
  renderStats(snap);
  if (snap.gameOver) showGameOver(snap.score);
  else hideGameOver();
}

async function onTileClick(e) {
  if (busy) return;
  const r = Number(e.currentTarget.dataset.r);
  const c = Number(e.currentTarget.dataset.c);
  const state = game.getState();
  if (state === STATE.GAME_OVER) {
    setToast('已结束，请重新开始', 'over');
    return;
  }
  if (state !== STATE.IDLE) {
    setToast('结算中…');
    return;
  }
  busy = true;
  setToast('');
  try {
    const result = await game.click(r, c);
    if (!result.ok && result.reason === 'invalid_cell') {
      setToast('无效格子');
    } else if (!result.ok && result.reason === 'no_energy') {
      setToast('体力不足', 'over');
    } else if (!result.ok && result.reason === 'game_over') {
      setToast('游戏结束，请重新开始', 'over');
    } else if (!result.ok && result.reason === 'hook_error') {
      setToast('动画异常，已恢复', 'over');
    } else if (!result.ok && result.reason === 'locked') {
      setToast('结算中…');
    }
  } finally {
    busy = false;
    paint();
  }
}

function restart() {
  game.reset();
  busy = false;
  lastScore = 0;
  hideGameOver();
  setToast('新的一局');
  paint();
}

resetBtn.addEventListener('click', restart);
againBtn.addEventListener('click', restart);

paint();
