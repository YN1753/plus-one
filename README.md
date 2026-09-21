# 数字加1（plusOne）

益智消除游戏《数字加1》核心业务逻辑模块。

- 5×5 棋盘
- 正交连通块 BFS 合成（N ≥ 3）
- 重力掉落与顶部补块
- 动态生成范围 + 倒加权分布
- 有限状态机：IDLE → USER_ACTION → MERGE → GRAVITY → AUTO_CHECK

核心代码位于 `src/`，规格见 `docs/compose/spec/plus-one-core.md`。
