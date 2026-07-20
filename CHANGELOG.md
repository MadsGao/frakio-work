# Changelog

## 0.1.3 Beta — 2026-07-20

### 重大数据安全修复

v0.1.2 将代表 `~/.hermes` 根配置目录的 Hermes Default 当成普通 Agent Profile 展示，并允许用户执行删除。删除接口同时把 Hermes 根目录本身判定为合法目标，导致删除 Hermes Default 时递归删除整个 `~/.hermes`，连带移除其他 Agent 的 profile、provider 和密钥环境。界面仍然保留 Agent 与模型名称，但 Hermes Runtime 已经没有可用的模型配置，因此所有 Agent 都会报告未配置 provider，无法回复。这不是模型供应商故障，而是 default profile 的界面语义、目录语义和删除边界不一致造成的。

v0.1.3 不再把 Hermes Default 导入 Agent 配置中心，并通过 `409 system_profile_protected` 在接口层阻止删除。普通 Agent 只能删除 `~/.hermes/profiles/<name>` 下的独立目录；明确绑定的 profile 缺失时会直接报告配置缺失，不再静默回退到 default。新增路径边界、删除接口和 Bridge profile 隔离测试，防止同类问题再次发生。

升级可以阻止误删再次发生，但不能自动恢复已经删除且没有备份的 Hermes 历史或记忆。已经受影响的用户需要从备份恢复 profile，或重新为各 Agent 配置模型。

## 0.1.2 Beta — 2026-07-19

Adds a complete local attachment workflow to Frakio Work. Images and common files can now be selected or dragged into the composer, previewed before sending, persisted with conversation history, and delivered to Hermes Agent through native image routing or controlled local file paths. Sent images render as full thumbnails and open in an accessible in-app full-window preview.

This release also repairs several conversation UI regressions. The conversation settings popover now stays above message content, the resource sidebar resizes the conversation instead of covering it, and the left sidebar resumes automatic animated collapsing as the window narrows. Attachment storage now streams content safely from the hidden local data directory, validates stored paths, cleans abandoned drafts, and uses Bridge protocol version 2 so incompatible runtimes cannot silently ignore files.

## 0.1.1 Beta — 2026-07-18

Repairs the first public macOS packages. The bundled Hermes Runtime now includes and validates `aiohttp 3.14.1`, the OpenAI-compatible Runtime API is exercised during release builds, packaged apps report the correct version, and desktop shutdown waits for owned Runtime processes. The launch screen no longer cross-renders or clips its working and welcome states, fonts are bundled for offline use, Runtime failures show a concise status with expandable logs, global search is functional, and automatic startup preserves existing Hermes configuration and credentials.

Known issue in v0.1.0: the clean bundled Runtime omitted `aiohttp`, so the Runtime API could not start; ASAR packaging also caused the update screen to display `v0.0.0`.

## 0.1.0 Beta — 2026-07-18

First public beta of Frakio Work. Includes the cross-platform source Web UI, local Hermes Agent integration, macOS desktop packaging for Apple Silicon and Intel, runtime management, GitHub Release update checks, backup-first Hermes updates, explicit telemetry consent, and local API hardening.
