# 通过 npm registry 分发，dist/ 仍提交进仓库

包名 `bookmark-cli` 在 npm 上已被他人占用，故以作用域包 `@chhsiching/bookmark-cli` 发布（命令名 `bookmark`/`bm` 由 `bin` 决定，不受包名影响）；发布由 push tag `v*` 触发的 GitHub Actions workflow 完成：测试 → dist 新鲜度门 → tag 与版本一致性校验 → `npm publish --provenance` → 自动建 GitHub Release。npm 成为分发主通道后，`dist/` 构建产物**仍**提交进仓库：npm tarball 从工作区打包 `dist/`，而提交产物让 GitHub 安装兜底无需安装时编译——nvm-windows 上 prepare 现场构建在 PR #9 期间被实测证明多层失败，这正是当初提交 dist 的原因，发布到 npm 不改变它。

## Consequences

- 发出去的包永远来自与仓库一致的 dist：CI 与 publish workflow 都有 dist 新鲜度门，`prepublishOnly` 再跑一次测试作最后防线（发布时测试跑两遍是有意为之）。
- 无作用域名 `bookmark-cli` 拿不回来；将来若想弃用作用域名，只能另发新包、旧包废弃，无法改名重发。
