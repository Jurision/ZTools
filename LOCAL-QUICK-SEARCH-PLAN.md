# Quick calculation and translation

> 历史计划：截至 2026-11-12 的完成状态、剩余需求及优先级以 [需求进度](docs/requirements-status.md) 为准。下文保留当时的范围与验证记录，不代表仍待开发。

Scope: local-only branch codex/quick-calculate-translate from bde6d32; stage and preview only. Never modify running release, startup, real profile, or proxy configuration.

1. Preserve original calculator precision/format for supported arithmetic through a bounded safe parser; golden and malformed/name tests.
2. Register Youdao and OpenAI-compatible translation as built-in providers using existing provider settings, masked local credentials, Electron network transport, 5-second deadline, safe errors, and mock-only tests.
3. Add built-in result rows and default-on calculation/translation switches; calculation first, translation after application hits; debounce, conservative disclosure policy, stale-request cancellation, cache, copy feedback and settings shortcut. Preserve explicit Ctrl+Shift+T.
4. Review all diffs and run isolated hidden source Electron coverage plus verify.ps1. Tests must not access real .ztools or real translation endpoints.
5. Commit only scoped files with pre-commit hook enabled; inspect ignored-CR diffs before restoring hook-only changes. Verify final source, stage.ps1 -SkipVerify, switch-release.ps1 preview only.
