---
feature: plus-one-core
status: delivered
updated: 2026-09-21
branch: feature/plus-one-core
commits: 3089066..13ede172
---

# 数字加1 核心业务逻辑

## Report

**What was built** — 交付了《数字加1》的可独立测试核心控制模块：5×5 棋盘（`id/val/isMerged`）、四向 BFS 连通合成（N≥3）、列重力压紧与顶部补块、动态生成范围 `[1, max(4, MaxVal-2)]` 及较平的倒加权分布，以及无死锁 FSM（IDLE→USER_ACTION→MERGE→GRAVITY→AUTO_CHECK→IDLE/GAME_OVER）。开局使用均衡袋装 + 反三连，降低「随便点就爆分」。点击扣体力、合成返还并按 `N × mergeVal × 20` 计分；非 IDLE 的 `click()` 立即返回 `{ok:false, reason:'locked'}`。另附浏览器演示页与 GitHub Actions Pages 工作流。

**Verification** — `npm test` → PASS（含开局反三连与盲点合成率测试）；`npm run typecheck` → PASS。

**Journey log** —
1. 空仓库先 `git init` + origin/main 骨架，实现落在 worktree `feature/plus-one-core`。
2. 计分取合并前 `mergeVal`（经用户确认），而非「先 +1 再计分」的字面顺序。
3. 审查指出「排队等待」违反 S2.6 输入锁契约；改为立即 `locked` 拒绝。
4. 视觉改为瓷白文房主题。
5. 玩家反馈开局过易：spawn floor 3→4、decay 3→2、weightExp 1→0.75，并做开局反三连。

## [S1] Problem

需要一款可独立测试、无 DOM 依赖的《数字加1》核心控制模块，覆盖：

- 5×5 棋盘状态模型与唯一单元格 id
- 正交连通块 BFS 合成判定（N ≥ 3）
- 消除后的列重力压紧与顶部补块
- 动态生成范围 + 倒加权概率，避免高数值卡死
- 有限状态机（FSM）严格单向流转，动画未结束禁止输入，无死锁

## [S2] Design

### 2.1 数据模型

```js
// board[row][col], row=0 在顶部, row=4 在底部
/** @typedef {{ id: number, val: number, isMerged: boolean }} Cell */
```

- `id`：全局递增整数，DOM Diff / 动画锚点
- `val`：正整数数值
- `isMerged`：是否处于合并展示态（合并动画期间为 true，GRAVITY 结算后清除）

棋盘常量：`ROWS=5`, `COLS=5`, `MAX_ENERGY=5`。

初始能量 `energy=5`，初始得分 `score=0`，初始 `comboCount=0`。
初始棋盘采用 **均衡袋装 + 反三连**（见 S2.3），开局盘面不预置可直接合成的 N≥3 块。

### 2.2 连通块 BFS

- 四向正交：`(-1,0),(1,0),(0,-1),(0,1)`，禁止对角线
- 源点 `(r,c)`，同 `val` 的连通区域全部收入
- 有效合成：`N = block.length >= 3`
- 每个已访问格只归属一个连通块

### 2.3 动态生成 Spawn（开局加难）

```
floor     = 4
decay     = 2
weightExp = 0.75
maxSpawn  = Math.max(floor, MaxVal - decay)   // 空盘/低 MaxVal → 4
range     = [1, maxSpawn]
weight(v) = 1 / v^weightExp                   // 仍偏小数字，但不如 1/v 陡
P(v)      = weight(v) / Σ weight(k)
```

- `MaxVal` / `MinVal`：当前全盘存活方块的最大/最小值
- **开局铺盘**：均衡袋（各数值出现次数接近）洗牌落入 25 格，再跑反三连修复，保证 `pickAutoMerge === null`
- **重力补块**：按当前 `MaxVal` 走加权生成（不在每局补块时强制反三连，连锁仍是玩法的一部分）
- 可注入 `rng(): [0,1)`；`createGame` 可覆盖 `spawnFloor/spawnDecay/spawnWeightExp/initialUpper`
- 设计意图：开局数值更散、盲点不易立刻得分；中后期靠 MaxVal 抬升仍会自然变难

### 2.4 重力压紧 Gravity Compaction

对每一列独立：

1. 自底向上收集存活方块，按原相对顺序沉底
2. 计算每块 `dropDistance`（下落格数；动画用）
3. 顶部空位生成新方块：初始 y 置于棋盘上方外侧（`spawnFromRow = -1 - emptyIndex`），入场后落位
4. 新方块 `isMerged=false`，新 `id`

返回结构供 UI 播放掉落动画：

```js
/**
 * @typedef {Object} GravityResult
 * @property {{id:number,fromRow:number,toRow:number,col:number,val:number,dropDistance:number}[]} moves
 * @property {{row:number,col:number,id:number,val:number,spawnFromRow:number}[]} spawns
 */
```

### 2.5 聚合中心选取 Merge Center

| 触发方式 | 中心 |
|---------|------|
| 玩家点击 `USER_ACTION` | 被点击格 `(r,c)`（即使它不是几何中心） |
| 连锁 / 全局扫描 `AUTO_CHECK` | 连通块中 `row` 最大者；若多个并列，取 `col` 最接近连通块列均值者；仍并列取较小 `col` |

合并处理（对中心以外节点）：

1. 标记 `isMerged=true`（成员 + 中心）
2. 成员销毁（从 board 移除），向中心动画由 hooks 承担
3. `mergeVal = center.val`（合并前共享值）
4. `center.val = mergeVal + 1`
5. `energy = min(MAX_ENERGY, energy + 1)`
6. `score += N * mergeVal * 20`
7. `comboCount += 1`
8. 动画结束后 → `GRAVITY`

> **得分取值约定**：`score` 使用合并前的共享值 `mergeVal`（即连通块同数值），而非升级后的值。理由：`N * val * 20` 自然描述「N 个 val 值方块」；升级是合并结果而非计分输入。玩家点击已单独完成一次 `+1`，合并再升级一次，与规则描述的「中心升级」一致。

### 2.6 状态机 FSM

```
IDLE
  │ 玩家点击 (r,c) 且 energy > 0
  ▼
USER_ACTION ── N<3 且 energy==0 ──► GAME_OVER
  │ N>=3                              ▲
  ▼                                   │
MERGE ──动画完──► GRAVITY ──掉落完──► AUTO_CHECK
                                      │
                    存在 N>=3 连通块 ──┼──► MERGE（无消耗连锁）
                    不存在且 energy==0 ┴──► GAME_OVER
                    不存在且 energy>0 ────► IDLE（comboCount=0）
```

规则要点：

1. **输入锁**：仅 `IDLE` 接受点击；`state !== IDLE` 时 `click()` **立即**返回 `{ok:false, reason:'locked'}`（禁止排队/挂起）
2. **体力**：点击扣 `energy -= 1` 并立即刷新快照；每次 MERGE 成功返还 `+1`（上限 5）
3. **连锁**：`AUTO_CHECK` 发现的合并不扣体力，但走同一 MERGE 结算（含返还与计分），`comboCount` 累加
4. **结束条件**：仅两处进入 `GAME_OVER`——(a) 点击后 N<3 且 energy==0；(b) AUTO_CHECK 无合并且 energy==0
5. **无死锁保证**：
   - 状态转移函数全函数，每个非终态必有出边
   - hooks 契约：必须返回 Promise 并在动画结束时 resolve（默认实现立即 resolve，测试可同步跑完）
   - AUTO_CHECK 最多扫描 25 格，每次 MERGE 至少消灭 N-1≥2 个格子并升级中心，棋盘有界 → 链式有限
   - 提供 `maxChainGuard`（默认 64）防御异常 rng；触达时强制收束回 IDLE/GAME_OVER 并标记 `degraded:true`

### 2.7 AUTO_CHECK 扫描顺序

线性扫描 `row` 从底到顶、`col` 从左到右，对未访问格 BFS。若有多个有效块，优先：

1. `N` 最大
2. 中心 `row` 最大（更靠下）
3. 中心 `col` 更接近列均值
4. `col` 较小者

### 2.8 模块接口

```
src/constants.js   — ROWS/COLS/MAX_ENERGY/STATE
src/board.js       — createBoard, cloneBoard, bfsBlock, pickAutoMerge,
                     computeGravity, spawnValue, fillEmptySpawn, findMaxMin
src/game.js        — createGame({rng, hooks}) → { click, getState, getSnapshot,
                     getBoard, reset, subscribe }
```

`createGame` 返回可序列化快照（经 `getSnapshot()`）：

```js
{
  state, board, energy, score, comboCount,
  lastMerge: null | { center, N, mergeVal, gained, combo, trigger },
  lastGravity: null | GravityResult,
  gameOver: boolean,
  degraded: boolean
}
```

Hooks（全部可选，缺省瞬时 resolve）：

```js
{
  onStateChange(state, snapshot),
  onUserIncrement({r,c,cell,snapshot}),
  onMerge({center, members, mergeVal, N, energy, score, combo, snapshot}),
  onGravity({moves, spawns, snapshot}),
  onSnapshot(snapshot),
  onGameOver(snapshot)
}
```

### 2.9 错误与边界

- 点击越界 / 空格：`{ok:false}`
- `energy<=0` 时点击：拒绝并保持 `GAME_OVER` 或已在结束态
- 重力后新块若立刻形成连通块，由后续 `AUTO_CHECK` 自然处理，不在 GRAVITY 内提前合并
- `isMerged` 在进入 GRAVITY 前对参与合并的中心保持可读，成员已删除

## [S3] Out of Scope

- 音效、皮肤、排行榜、持久化
- 关卡编辑器、道具系统、联网对战
- 对角线连通、N<3 特殊消除、主动使用技能
- React/Vue 等重框架 UI（演示页为原生 ESM + CSS）

## [S4] GitHub Pages 托管（追加）

用户要求用 GitHub Actions 实现 Pages 托管。

### 4.1 静态站点

- 根目录 `index.html` + `src/ui.js` 浏览器演示（消费同一套核心模块，ESM 相对路径导入）
- UI 只负责渲染与 hooks 动画，规则完全由 `src/game.js` 驱动
- 站点产物：`index.html` + `src/`（不含 tests/docs）

### 4.2 Actions 工作流 `.github/workflows/pages.yml`

- 触发：`push` 到 `main`，或 `workflow_dispatch`
- 权限：`contents: read`，`pages: write`，`id-token: write`
- `build` job：checkout → Node 23 → `npm test` → staging `_site/` → `configure-pages` → `upload-pages-artifact`
- `deploy` job：`needs: build`，`actions/deploy-pages@v4`，environment `github-pages`
- 并发：`group: pages`，`cancel-in-progress: true`
- 仅当测试通过才部署

### 4.3 仓库设置

- GitHub 仓库 Settings → Pages → Source 选择 **GitHub Actions**
- 合并到 `main` 并 push 后自动部署；Pages URL 由 Actions 环境输出

## Tasks

- [x] T1: 搭建 package 骨架与常量模块 — acceptance: `src/constants.js` 导出 STATE/ROWS/COLS/MAX_ENERGY，node 可 import (covers: S2.1,S2.6)
- [x] T2: 实现 board 数据与 BFS 连通块 — acceptance: 四向 BFS 正确返回连通块；N≥3 判定；对角线不连通 (covers: S2.1,S2.2)
- [x] T3: 实现动态生成与倒加权 spawn — acceptance: 空盘 range[1,3]；有 MaxVal 时 range=[1,max(3,MaxVal-3)]；小数字概率显著更高（可注入 rng 验证） (covers: S2.3)
- [x] T4: 实现重力压紧与补块 — acceptance: 列内沉底相对顺序不变；dropDistance/spawns 字段正确；顶部补块用 spawn 算法 (covers: S2.4)
- [x] T5: 实现 FSM 控制器 createGame — acceptance: IDLE→USER_ACTION→MERGE→GRAVITY→AUTO_CHECK→IDLE/GAME_OVER 完整流转；非 IDLE 拒绝点击；energy/score/combo 符合公式 (covers: S2.5,S2.6,S2.8)
- [x] T6: 聚合中心选取规则 — acceptance: 点击触发用 (r,c)；连锁用 max-row / 近中心 col (covers: S2.5,S2.7)
- [x] T7: 单元测试覆盖算法与状态机 — acceptance: `npm test` 全绿，覆盖 BFS/生成/重力/计分/连锁/GAME_OVER/输入锁 (covers: S2.2,S2.3,S2.4,S2.5,S2.6,S2.7)
- [x] T8: GitHub Actions Pages 托管 + 可玩演示页 — acceptance: workflow 在 push main 时先 npm test 再部署 _site；index.html 可玩并调用 createGame (covers: S4)
- [x] T9: 独立审查与规格 finalize — acceptance: 审查通过 critical=0，spec status=delivered (covers: S2,S4)
