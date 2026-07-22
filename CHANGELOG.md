# Changelog

## 0.1.4 Beta — 2026-07-22

### 0.1.4 后续修订

本次继续使用 0.1.4 版本号，并重新生成 Apple Silicon 与 Intel 下载资产。修订集中处理首个 0.1.4 发布后发现的 Provider 配置与桌面交互问题；此前下载的 0.1.4 安装包与本次修订包的摘要不同。

Provider 验证现在以弹窗中的完整草稿为准。切换 API 协议、Base URL、默认模型或能力设置后，“验证并保存”会使用最新配置连接线路，成功后一次性覆盖原配置，失败时保留原来的可用配置。已有 Provider 的 API Key 可以在相同 HTTPS Origin 下直接复用于获取模型和验证；只切换 Chat Completions、Responses 或 Codex Responses 协议时不需要重新输入密钥。更换域名、协议或端口后必须提供新密钥，旧密钥不会发送到新地址。弹窗同时增加未保存更改与未验证连接参数的确认，减少误覆盖。

OpenAI Codex、Claude OAuth 和 Google Gemini OAuth 改用各自的原生验证路径。Codex 使用当前 Hermes Profile 的 OAuth Token、ChatGPT Account ID 和账号模型目录完成无额外推理消耗的授权验证；Claude OAuth 使用 Bearer Token 与 OAuth 专用请求头；Gemini OAuth 使用 Google Code Assist 的账号与模型调用流程。验证失败不会清除已成功获取的目录、授权状态或原 Provider 配置，也不会再把 OAuth 凭据误当成普通 API Key。

修复官方 Codex 模型目录中推理档位采用对象结构时无法识别的问题。现在会读取每个档位对象的 `effort`，保留账号目录返回的顺序、默认档位和服务层信息；`gpt-5.6-sol` 等模型会按当前账号实际目录显示可用推理强度。能力合并改为逐字段补齐，Provider 明确声明的限制仍然优先。模型能力缓存版本同步升级，旧版保存的空推理映射会自动失效并重新解析。

Provider 添加、编辑及 OAuth 授权弹窗的关闭按钮明确脱离 Electron 窗口拖拽区域。桌面端完整点击范围为 40 × 40px，窄屏为 44 × 44px，按钮中心、边缘和四角都能正常响应；持久模态、未保存更改确认和底层窗口拖拽行为保持不变。

### 工作台与 Agent 创建

新安装现在以完全空白的工作台开始，不再自动创建示例 Agent、模型、欢迎对话或知识库。旧安装升级时会先备份 state，只清理仍与历史内置内容完全一致的演示数据；用户创建、编辑、同步、引用或配置过密钥的内容不会被删除。本地 Hermes Profile 只有在用户主动点击“同步本地 Hermes 设置”后才会导入。

Agent 现在可以在尚未配置模型时创建。首个 Agent 会成为默认 Agent，创建完成后立即尝试启动对应 Gateway，并加入按 Profile 自动启动名单。创建请求具备持久化幂等保护，网络重试不会重复创建 Agent；Gateway 启动失败会保留 Agent 并显示可重试状态。没有 Agent 或可用模型时，对话发送会保持禁用并提供对应入口。

Gateway 的首次启动、刷新和重启加入即时加载状态，操作期间不会重复提交。发送消息后输入框立即清空；启动失败时，只有用户没有输入新草稿才恢复原文，避免覆盖正在编辑的内容。

### Provider Adapter 与模型运行参数

模型运行设置改为由 Provider Adapter 和模型能力目录统一驱动。首批覆盖 OpenAI Responses、OpenAI Chat Completions、OpenAI Codex Responses、Anthropic Messages、DeepSeek、OpenRouter、Gemini、LM Studio 和常见第三方中转格式。Provider 可以设置默认协议，单个模型可以覆盖协议；未知中转站使用保守的通用 Adapter，不再因为模型 ID 相同而继承其他线路的能力。

推理强度支持 `off / minimal / low / medium / high / xhigh / max / ultra` 及未来扩展档位，并使用模型级三态映射区分支持、不支持和未知。速度服务层支持标准与快速模式，OpenAI Priority 会转换为 `service_tier: "priority"`。对话切换模型后会重新校验推理和速度设置，无效值恢复到模型默认并同步保存到 Thread。Bridge 只接收服务端已经校验的运行参数，并会在单次运行结束后恢复 Agent 原配置。

IkunCode 改用 OpenAI Codex Responses 请求路径。`gpt-5.6-sol` 提供 `low / medium / high / xhigh / max / ultra` 六档推理和 Priority 快速服务层。修复 DeepSeek 关闭推理时错误发送 `reasoning_effort: "none"` 的问题；官方 DeepSeek 现在发送 `thinking: { type: "disabled" }`，不会再被接口拒绝。

### 模型目录与能力验证

模型目录按 Provider、协议、Base URL 类型和模型 ID 隔离缓存，支持四小时缓存、强制刷新和最后一次成功结果恢复。普通 `/models` 响应只补充模型 ID，不会推测上下文、推理或速度能力；手动覆盖始终优先于 Provider 富目录、Hermes Runtime 目录和 Frakio 精确内置目录。

自动模式下能力未知的 Responses 中转站可以使用“验证并识别能力”。Frakio Work 会先验证连接，再分别探测推理档位和 Priority 服务层。明确的参数错误会标记为不支持，鉴权失败立即停止，限流、超时和服务端错误继续保持未知，不会误报为不支持。探测结果只属于当前 Provider、协议、Base URL 和模型，界面标记为“线路验证”，不会冒充官方确认。该操作由用户主动触发，会产生多次低额度请求；后台目录刷新不会发送推理请求。

### OAuth 授权与 Provider 配置

OpenAI Codex、Claude OAuth 和 Google Gemini OAuth 在授权前不再展示静态候选模型。Codex 授权完成后会使用当前账号令牌和账号 ID 读取账号级模型目录，过滤隐藏模型并按 Provider 优先级排序；实时目录失败时恢复该账号最后一次成功目录，首次失败则保持模型为空，不会创建不完整 Provider。Claude 和 Gemini 在没有账号级目录时才使用明确标记的 Frakio 内置目录。

桌面端增加受控的外部浏览器桥接。Codex、Claude、Google 授权地址和 Frakio GitHub Release 地址经过 HTTPS 域名与路径白名单验证后由系统浏览器打开，其他地址会被拒绝。授权页打开失败时可以手动重试，现有授权轮询继续在 Frakio Work 内完成。

IkunCode、Codex-apikey.fun 和 Claude-apikey.fun 已从“预设”列表移除，新配置统一通过“自定义”添加。旧配置仍保留协议与 Adapter 兼容；自定义填写 IkunCode 官方中转地址时，仍会自动识别 Responses 协议和精确能力映射。Provider 编辑弹窗改为固定标题、独立滚动内容和固定操作栏，长目录错误与能力配置不会再溢出视口。

### 模型菜单与授权交互

对话输入框中的模型选择器改为紧凑的轻量毛玻璃菜单。桌面端主菜单固定锚定在触发按钮附近，二级面板根据可用空间自动向左或向右展开，切换模型、推理和速度分区时主面板不再跳动；窄于 720px 时使用单面板钻取。大量模型只滚动模型列表，菜单保持在视口安全边距内。

选择模型后菜单保持打开，用户可以继续调整推理强度和速度；点击菜单外部、再次点击触发按钮或按 Escape 才会关闭。当前模型、推理档位和速度选项都有清晰的选中标记，未知能力与明确不支持使用不同提示。

Provider 添加、编辑和 OAuth 授权弹窗现在是持久模态。点击遮罩或按 Escape 不会关闭，也不会丢失表单、授权码或轮询状态。用户从系统浏览器返回 Frakio Work 后可以继续原流程；只有右上角关闭、底部取消、保存成功或授权成功才会结束对应弹窗。手动关闭授权窗会同时清理前端轮询和延迟回调。

### Runtime 状态与兼容性

修复 Provider 目录重构后 Runtime API 健康检测引用已删除 `parseModelIds` 导致的启动错误，并统一支持 OpenAI `data`、Hermes `models` 和字符串模型列表。

聊天 Bridge 现在明确属于工作台核心服务；供第三方 OpenAI-compatible 客户端使用的 Runtime API 改名为“外部兼容 API”，并作为可选服务展示。只有 Bridge 等核心服务失败才会把工作台标记为不可用；外部兼容 API 未运行时保留诊断警告，但不会影响 Frakio Work 对话或阻止进入工作台。

本版本继续内置 Hermes Runtime 0.18.2，并补充 Provider 目录、主动能力探测、OAuth 账号目录、外部链接白名单、Runtime 状态、Bridge 运行参数和空白安装流程的回归测试。

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
