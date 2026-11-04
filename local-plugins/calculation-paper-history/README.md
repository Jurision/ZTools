# 本地原版计算稿纸历史增强

只扩展用户已有的计算稿纸 1.4.2：保留原版 React 编辑器、计算引擎、大公式/大结果、备注、复制和键盘行为，增加右侧日期历史、新建、500ms 自动保存、退出/失焦刷新。Ctrl+S 的原版命名对话框更新当前稿纸；日期栏每项可点笔形按钮或双击就地重命名（Enter/失焦保存，Esc 取消，清空恢复日期名），改过名的空白新稿纸也会保存，不再被“新建”复用；原版稿纸抽屉加载携带 ID，删除同步历史状态。

`node scripts/local/build-paper-history.cjs` 读取已安装程序资源，校验原版 JS SHA256，生成 `.local-work/plugins/calculation-paper-next`（0.2.0）及隔离测试基准 `calculation-paper-baseline`。不会读取用户数据库或安装/重启插件。原版资源不提交仓库；完整插件未声明开源许可，依赖许可不能视为其整体许可。

复用原先原创版本的 PaperStore 和 `paper/` 数据格式，因此 calculation-paper-next 的已有记录保持兼容。原版计算只由原 bundle 的引擎执行；core.js 的其他导出不用于计算。第一次打开保留一个空白工作稿，旧记录按创建时间倒序显示。保存冲突保留当前内容并阻止切换，点击状态文字重试。

验证：`node --test local-plugins/calculation-paper-history/history.test.cjs`，以及根项目隔离源码 Electron E2E。日期栏选择器为 `#history-new`、`#history-list .history-item[data-id]`、`#history-status`；编辑器仍为 `.calc textarea`、`.calc .result`。自有调试桥 `window.PaperHistory.active` 包含 app/store/navigate/flush。
