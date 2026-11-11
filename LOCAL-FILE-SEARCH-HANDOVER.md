# 硬盘文件搜索：交接说明（给接手的 Codex）

分支 `codex/quick-calculate-translate`。本文件对应的提交是**未完成的中间状态（WIP）**：代码已写完并通过类型检查和新增单元测试，但**还没跑过 e2e、没跑 verify.ps1、没打包、没切换上线、没推送**。全程用中文白话跟用户沟通（用户不是技术人员）。

## 用户已同意并已完成的环境设置（不要重做）

- 用户不想从官网下载。已用 `scripts/local/install-everything-service.ps1` 把「本地搜索」插件自带、带 voidtools 签名的 Everything 1.4.1.1009 复制到 `C:\Program Files\Everything` 并装成服务（`sc query Everything` = RUNNING，自动启动）。卸载：同一脚本加 `-Uninstall`。
- `C:\Program Files\Everything\Everything.ini` 只有 `app_data=1`，真正的设置在 `%APPDATA%\Everything\Everything.ini`（改前备份为同目录 `Everything.ini.bak-20261112`）。已设置：`run_as_admin=0`、`http_server_enabled=1`、`http_server_bindings=127.0.0.1`、随机端口、用户名 `ztools` + 随机密码、`http_server_allow_file_download=0`。用户已同意这样设置。**不要把密码写进代码、日志、文档或提交。**
- 插件自带那份 `~\.ztools\plugins\everything\preload\everything\Everything.ini` 已改 `run_as_admin=0`、`allow_http_server=0`（备份同目录 `.bak-20261112`）。
- Everything 不设开机自启：ZTools 启动 5 秒后若功能开启且连不上，会自己执行 `Everything.exe -startup`。
- 已核实：索引约 800 万项，C/D/E 都能查；查「家人」正好返回验收里的 5 项。本机没有名为「家里人」的文件，这条验收只能靠测试夹具验证。

## 已实现（都在工作区/本次提交里）

- `src/shared/fileSearch.ts`：设置与专页状态归一化、`f 关键词` 前缀、`re:` 正则、分词（NFKC + 小写）、Everything 查询语句生成、匹配打分（完全相同 0 / 开头 10 / 包含 20 / 拼音 30 / 插字 40 / 错字 50，多词取最差的一档）、排除目录、类型分类、高亮。
- `src/main/core/fileSearch/everythingClient.ts`：读 ini 得到端口和凭据、只连 127.0.0.1、必要时后台启动 Everything。测试环境（`ZTOOLS_E2E`/`ZTOOLS_BACKGROUND_TEST`/vitest）下**只认 `ZTOOLS_EVERYTHING_INI`**，否则功能不可用，保证测试不会查真实硬盘。
- `src/main/core/fileSearch/fileSearchService.ts`：分档查询（整名、开头、包含各取最近修改的若干条）+ 内存里的中文名列表（`regex:[㐀-鿿]`，本机约 4.6 万项，10 分钟刷新）做拼音/插字/错字；`deep` 时再对英文词跑插字正则和错字通配（约 0.3–1.2 秒，只在专页用）。
- `src/main/api/renderer/fileSearch.ts`：IPC `file-search:query`、`file-search:open`（第二个参数 true = 打开所在文件夹并选中）；`internal:update-file-search-settings` 在 `src/main/api/plugin/internal.ts`。
- 渲染层：`composables/useFileSearch.ts`、`useFileActions.ts`、`components/search/FileResultRow.vue`、`FileSearchPage.vue`；`SearchResults.vue` 在软件结果后加最多 5 条文件行和「更多文件结果」；`App.vue` 在输入以 `f ` 开头时用专页替换结果区；`SearchBox.vue` 在专页里不触发双击空格/Ctrl+Shift+T 翻译。
- 设置：`internal-plugins/setting/src/components/SearchSourcesSetting.vue` 加开关和排除目录编辑框；存 `settings-general.fileSearch`。专页的精确/模糊、类型、排序记在 localStorage `ztools-file-search-view`，主搜索框也跟随这个模式。
- 操作：回车打开；Ctrl+回车打开所在文件夹；Ctrl+Shift+C 复制路径；右键菜单三项。
- 测试：`tests/shared/fileSearch.test.ts`（10 项通过）；`tests/helpers/fakeEverything.ts` 是假的 Everything HTTP 服务和夹具数据 `FAKE_DISK`，**还没有被任何测试使用**。

## 还没做（按顺序）

1. 单元测试：用 `fakeEverything` 测 `FileSearchService`（把 `process.env.ZTOOLS_EVERYTHING_INI` 指向 `iniPath` 后 `new FileSearchService()`）：「家人」排序与默认排除、精确模式不出「家里人」、`zyx`/`zhuyuanxin`、「朱元昊」后面带出「朱元欣」、「家人 照片」、`re:`、类型筛选、最近修改排序、`deep` 下 `report` 找到 `repart-notes`/`re-port`、ini 缺失或密码错返回 unavailable。再测 `parseEverythingIni`、`resolveEverythingIniPath`。
2. e2e：新增 `tests/e2e/file-search.spec.ts`，照 `tests/e2e/quick-search.spec.ts` 的写法（隐藏窗口、临时数据目录、DOM 事件输入），启动时加环境变量 `ZTOOLS_EVERYTHING_INI`；用 `ipcMain.removeHandler` 替换 `file-search:open`、`copy-to-clipboard`、`show-context-menu`，不真的打开文件。覆盖：主框 5 条 + 完整路径 + 软件结果仍在前面；「更多文件结果」进专页；`f 家人`；三个工具栏控件改了立即刷新；回车/Ctrl+回车/Ctrl+Shift+C；设置关掉后主框不显示。加进 `scripts/local/verify.ps1` 的 playwright 列表。
3. 确认现有 e2e（尤其 `quick-search.spec.ts`、`super-panel-layout.spec.ts`）没被新增的行影响。
4. 后台跑 `pwsh -File scripts/local/verify.ps1`（几分钟）。
5. 人工核对界面：窗口高度随专页内容变化、类型面板展开、深浅色下的颜色（用了 `--primary-color`、`--primary-light-bg`、`--text-secondary`、`--hover-bg`）。截屏或操作用户屏幕前要先得到当次同意。
6. 文档：把功能说明写进 `docs/quick-search.md` 或新建 `docs/file-search.md`（用法、匹配规则、排除目录、Everything 服务与查询口、已知限制），然后删除本交接文件。
7. 提交（去掉 WIP），`stage.ps1 -SkipVerify` 打包，请用户从托盘退出 ZTools，`switch-release.ps1 -Action Activate`，手动把 HKCU Run 的 `top.z-tools` 改到新版本 ZTools.exe 并核对实际运行路径。推送到 origin 前先问用户。

## 已知限制与待定

- 多个词都只在**文件名**里匹配；想限定文件夹可输入带反斜杠的片段，如 `家人\ jpg`。Everything 按整条路径匹配要 0.7 秒以上，所以没默认做。
- 拼音/插字/错字对中文名文件最多滞后 10 分钟（新建的中文名文件按原字搜是实时的）。
- 英文词的错字搜索只在专页、且词长 5–10 个字符时进行。
- 精确模式不含拼音：拼音归在模糊里，排在原字匹配之后、插字和错字之前。
- 默认排除了整个 `\AppData\`、`:\ProgramData\`、`:\Windows\` 等，见 `DEFAULT_FILE_SEARCH_EXCLUDES`；没有排除 `Program Files`。
- 文件行图标是按类型画的简单线条图标，没有取系统图标。
- 提交规矩见任务原文：pre-commit 会把约 440 个无关文件改成 LF，用 `git diff --ignore-cr-at-eol --name-only` 确认后 `git checkout -- .` 恢复；不要跳过 hook。
