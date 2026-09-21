# 数字加1（plusOne）

益智消除游戏《数字加1》核心业务逻辑与 GitHub Pages 演示。

## 玩法

- 5×5 棋盘，点击方块 `val += 1` 并消耗 1 点体力
- 上下左右正交相连的同数方块 **N ≥ 3** 时合成
- 合成：中心 `val + 1`，体力 +1（上限 5），`score += N × val × 20`
- 开局：均衡袋装 + 反三连，盲点不易立刻得分
- 重力掉落 + 动态生成 `[1, max(4, MaxVal-2)]`；连锁合成不耗体力

## 开发

```bash
npm test          # node:test 单元测试
npm run typecheck # 语法检查
```

核心代码：`src/`  
规格：`docs/compose/spec/plus-one-core.md`  
演示入口：`index.html`（ESM，直接打开或经 Pages 托管）

## 部署

推送到 `main` 后，`.github/workflows/pages.yml` 会跑测试并部署到 GitHub Pages。

仓库 Settings → Pages → Source 请选择 **GitHub Actions**。
