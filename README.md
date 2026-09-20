# bookmark-cli

个人单机使用的命令行网页书签管理工具：把 URL 连同自动抓取的标题（Title）、标签（Tag）与备注（Note）存进本地一个 JSON 文件，全字段模糊搜索随时找回，支持导入浏览器书签、导出 Markdown / HTML / JSON。可执行命令同时注册为 `bookmark` 与 `bm`——正式脚本用全名，日常手打用短名。

- **Bookmark（书签）** 由 URL 唯一标识：同一 URL 在库中只存一条，重复添加会明确报错。
- **Tag（标签）** 是唯一的组织手段，没有文件夹；一个书签可以挂多个标签。
- 单用户、无服务端、无多机同步；除删除确认外全程无交互，可组合进脚本。

## 安装

要求 Node.js ≥ 20：

```bash
npm i -g @chhsiching/bookmark-cli
```

安装后 `bookmark` 与 `bm` 两个命令都可用（本文以下统一用短名 `bm`）。

## 快速上手

```bash
bm add https://nodejs.org --tags dev,docs --note "runtime docs"
bm search nodejs
bm open 1
```

## 子命令

### bm add — 保存书签

```bash
bm add https://nodejs.org/en --tags dev,docs --note "official runtime docs"
```

- 不带参数时从剪贴板读取 URL：`bm add`
- 自动抓取页面 `<title>`（3 秒超时），离线或失败时回退为域名；用 `--title` 覆盖：

```bash
bm add https://example.com --title "示例站点"
```

- URL 已存在时报错并显示已有书签的 ID；`--force` 改为原地更新（重新抓取/覆盖给定字段）：

```bash
bm add https://nodejs.org/en --force --tags node,docs
```

| 选项 | 说明 |
| --- | --- |
| `--title <title>` | 覆盖自动抓取的标题 |
| `--tags <tags>` | 逗号分隔的多个标签，如 `"dev,docs"` |
| `--note <note>` | 一条自由备注 |
| `--force` | URL 已存在时更新而非报错 |

### bm list — 列出书签

按创建时间倒序（最新在前）：

```bash
bm list
bm list --tag dev          # 只看挂有某个标签的书签
bm list --json             # 机器可读输出，供脚本二次处理
```

### bm search — 全字段模糊搜索

对标题、标签、URL、备注做模糊匹配（记不清完整词也能找到），结果按匹配得分降序、同分新的在前：

```bash
bm search nodejs
bm search "css ref"        # 能命中备注里的 "css reference"
bm search nodejs --json    # JSON 输出
bm search nodejs --open    # 直接用默认浏览器打开最佳匹配
```

### bm open — 打开书签

```bash
bm open 3                  # 用系统默认浏览器打开 #3
```

### bm edit — 修改书签

`--tags` 为整体替换（看到的就是最终状态），其余字段只改给出的：

```bash
bm edit 3 --title "Node.js 官网"
bm edit 3 --note "重新读一遍"
bm edit 3 --tags dev,node  # 标签集整体替换为 dev,node
bm edit 3 --tags ""        # 清空标签
```

### bm rm — 删除书签

默认单行确认；没有回收站，删除即永久：

```bash
bm rm 3          # 询问 y/n
bm rm 3 -y       # 跳过确认，脚本友好
```

### bm tags — 标签总览

```bash
bm tags          # 全部标签及各自计数，count 降序、同数按字母序
```

### bm export — 导出

默认输出 Markdown 到 stdout；`-o` 写文件。Markdown 与 HTML 均按标签分组，多标签书签出现在多个分组，无标签书签归「无标签」；JSON 即存储格式（无损备份）：

```bash
bm export                                    # Markdown 到 stdout
bm export --format md -o bookmarks.md        # Markdown 写文件
bm export --format html -o bookmarks.html    # 浏览器可导入的 Netscape HTML
bm export --format json -o backup.json       # 无损 JSON 备份
```

### bm import — 导入

导入浏览器导出的 Netscape 书签 HTML，或本工具导出的 JSON 备份（格式自动识别）。文件夹路径的每一段各自成为一个标签；URL 已存在一律跳过（即使标题不同），结束报告"新增 N 条、跳过 M 条"：

```bash
bm import bookmarks.html
bm import backup.json
```

## 数据存在哪里

单个 JSON 文件，路径跟随平台惯例：

| 平台 | 路径 |
| --- | --- |
| Windows | `%APPDATA%\bookmark-cli\bookmarks.json` |
| macOS | `~/Library/Application Support/bookmark-cli/bookmarks.json` |
| Linux | `$XDG_CONFIG_HOME`（默认 `~/.config`）`/bookmark-cli/bookmarks.json` |

文件是人类可读的 JSON，每次写入全量重写。直接 `cp` 这个文件就是备份；用 `bm export --format json` 导出再 `bm import` 可原样恢复（ID、时间戳完整保留）。

## 从浏览器迁移

1. 在浏览器书签管理器里"导出书签"为 HTML 文件（Chrome/Edge/Firefox 均支持）；
2. 运行 `bm import 导出的文件.html`——文件夹层级会被拆成逐段标签，与你手工打的标签汇流成统一的组织方式；
3. 重复导入同一文件无副作用（按 URL 判重，全部跳过）。

## 开发

```bash
git clone https://github.com/ChHsiching/bookmark-cli
cd bookmark-cli
npm install
npm test           # 构建 + 全部测试
```

`dist/`（编译产物）直接提交在仓库里：npm 发布从工作区打包 `dist/`，提交产物则让 GitHub 兜底安装无需在安装时编译（nvm-windows 上 prepare 现场构建不可靠，见 [docs/adr/0002-npm-distribution.md](docs/adr/0002-npm-distribution.md)）。改动 `src/` 后记得 `npm run build` 并把 `dist/` 一并提交——CI 与发布流程都有 dist 新鲜度门，忘记提交会直接红。

### 发版

在 main 上：

```bash
npm version patch        # 或 minor / major：改版本号、提交并打 tag
git push --follow-tags   # 触发 publish workflow：测试 → 发布 npm → 建 GitHub Release
```

> 无法走 npm 时的兜底安装：`npm i -g github:ChHsiching/bookmark-cli`。Windows + nvm-windows 用户如遇命令报"找不到模块"，加 `--install-links=true` 重装一次。

领域术语见 [CONTEXT.md](CONTEXT.md)；为什么只有标签没有文件夹见 [docs/adr/0001-tags-only-no-folders.md](docs/adr/0001-tags-only-no-folders.md)。
