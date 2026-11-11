# 本机 ZTools 迭代流程

基线为上游 v3.2.0；正式使用版仍在 `%LOCALAPPDATA%\Programs\ZTools`。开发目录和 `.local-work` 产物互相独立。不要直接执行旧的 `pnpm dev:clean`/`pnpm kill`，它会影响其他 Electron 进程。

## 日常修改

1. 在 `codex/` 功能分支修改，需求依据 `LOCAL-DEVELOPMENT-PLAN.md` 和原开发需求清单。
2. 后台验证：`pwsh -File scripts/local/verify.ps1`。首次可加 `-InstallDependencies`。
3. 验证会跑类型检查、单元测试和源码 Electron 隔离测试；不会为了测试打安装包，不使用真实 `.ztools`。后台测试必须设置专用的测试标识和临时数据目录，不能注册全局鼠标钩子或抢占前台。
4. 发布准备：`pwsh -File scripts/local/stage.ps1 -SkipVerify`。它校验源码指纹与验证结果一致，构建便携发布目录及计算稿纸插件 ZIP；原安装不会被覆盖。源码有变化必须重新验证。
5. 查看待切换版本：`pwsh -File scripts/local/switch-release.ps1`，默认仅预览。

## 切换与回退

先正常退出 ZTools，让尚未保存的插件内容落盘。切换脚本检测到 ZTools 正在运行时会拒绝，不强杀用户应用。

- `pwsh -File scripts/local/switch-release.ps1 -Action Activate`：复制已关闭的 `.ztools` 到 `.local-work/backups` 后启动本地版。原安装文件保留不动。不会自动改 Windows 自启项。
- `pwsh -File scripts/local/switch-release.ps1 -Action Rollback`：在正常退出本地版后启动原安装。保留最新数据，不自动用旧备份覆盖后来新增的计算。
- 备份恢复需要明确选择时间点；不要把“回退程序”误当成“回退个人数据”。

## 计算稿纸数据

当前版本 `calculation-paper-next` 0.2 保留原版编辑器与计算引擎，仅增加日期历史和自动保存；0.1 的重写界面已停用。同一命名空间保留 0.1 中的记录，不覆盖原版 `calculation-paper` 数据。

0.2.1 将顶部搜索框接入历史侧栏，可搜索稿纸名称、公式、备注与日期；筛选不切换当前稿纸，也不修改已保存内容。独立窗口隐藏重复的插件名称文字，保留图标和窗口控制。插件 ZIP 与主程序分开更新：切换主程序并不会自动替换已安装插件，更新同名插件时须先退出并备份插件目录与设备数据库，保留账号内的稿纸记录。

0.2.3 将右侧历史删除改为点击立即删除、底部 2 秒倒计时撤回，连续删除可整组撤回；删除立即落盘，关闭或重载后撤回入口消失。0.2.2 的内联确认已移除，删除失败保留记录，删除当前或最后一份后提供可用空白稿纸。主搜索框的运算结果改为 Enter 进入稿纸，Ctrl+Enter 或点击复制结果；稿纸编辑器内部按键不变。当前需求完成状态及后续优先级统一见 `docs/requirements-status.md`。

验证流程调用 `scripts/local/build-paper-history.cjs`，从已缓存的原版 1.4.2 程序包 `.local-work/fixtures/calculation-paper-original.asar` 生成补丁插件，验证时不读取真实 `.ztools`；构建器校验原 bundle 的 SHA256，仅修改三处接入点。原始程序包和生成文件不提交、不发布，仓库仅保存原创扩展与补丁器。首次换机器时须提供相同合法安装副本（可传给构建器作为参数）。

首次迁移时，先只读导出旧插件保存的快照，再由切换脚本通过 PaperStore 导入相同数据格式；0.1 已迁入的记录无需重复导入：

`node scripts/local/export-old-papers.cjs C:\Users\mx-ui\.ztools .local-work/backups/old-papers.json`

导出工具只读取当前账号下 `PLUGIN/calculation-paper/paper/` 记录，不读其他插件，不打印正文，不修改原数据库，不覆盖已有导出。旧插件还在内存中、从未保存的草稿不在导出范围，切换前须在旧插件中先保存。不要将个人导出或 profile 备份提交到 Git。

## 已知边界

独立测试能覆盖搜索逻辑和插件持久化；实际用户切换后仍需简短体验确认。快速翻译使用用户配置的有道或 OpenAI 兼容服务；仅通过显式快捷键翻译，输入或粘贴不自动发送，规则及费用边界见 `docs/quick-search.md`，Ctrl+Shift+T 显式触发仍可用。快捷触发只在启动器内生效。后台开发模式不得用作正式日常启动模式。

Windows 应用索引还会补查 App Paths、安装注册信息及用户 Programs 目录中的图形应用，并排除卸载、更新、辅助程序。未注册且放在任意目录的便携应用仍需通过设置的“本地启动”添加；不声称能发现整块磁盘上的任意程序。
