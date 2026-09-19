# bookmark-cli

个人单机使用的命令行网页书签管理工具：保存、搜索、导入、导出网页书签。单用户，无服务端，无多机同步。

## Language

**Bookmark（书签）**:
一条被保存的网页引用，由 URL 唯一标识——同一 URL 在库中只存在一条。包含标题、标签（多个）、备注和创建时间。只收录网页 URL，不收录本地目录、文件或命令片段。
_Avoid_: 收藏、favorite、entry、link（泛指单条记录时）

**Tag（标签）**:
附加在书签上的自由文本词，与书签是多对多关系，是唯一的组织手段。本工具没有文件夹、没有分类、没有集合。
_Avoid_: folder/文件夹、category/分类、collection/集合、group

**Note（备注）**:
附在书签上的自由文本注释，内容仅由用户书写；不用于存放自动抓取的内容。
_Avoid_: description/描述、comment/评论

**Title（标题）**:
书签指向网页的标题，自动抓取失败时回退为域名，可被用户覆盖。
_Avoid_: name、label
