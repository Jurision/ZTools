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

新版是独立插件 `calculation-paper-next`，不覆盖旧插件。可在插件安装入口安装发布目录中的 ZIP。旧稿纸数据保留。

需要迁移时，先只读导出旧插件保存的快照，再在新插件中导入：

`node scripts/local/export-old-papers.cjs C:\Users\mx-ui\.ztools .local-work/backups/old-papers.json`

导出工具只读取当前账号下 `PLUGIN/calculation-paper/paper/` 记录，不读其他插件，不打印正文，不修改原数据库，不覆盖已有导出。旧插件还在内存中、从未保存的草稿不在导出范围，切换前须在旧插件中先保存。不要将个人导出或 profile 备份提交到 Git。

## 已知边界

独立测试能覆盖搜索逻辑和插件持久化；实际用户切换后仍需简短体验确认。翻译依赖已有翻译提供方，不额外配置外部服务或自动发送输入。快捷触发只在启动器内生效。后台开发模式不得用作正式日常启动模式。
