# Frakio Work

[English](README.en.md)

Frakio Work 是面向 [Hermes Agent](https://github.com/NousResearch/hermes-agent) 的开源多智能体工作台。它把对话、Agent、模型、MCP、频道、任务、知识库和 Runtime 管理放在同一个本地界面里。

> v0.1.0 是公开 Beta。macOS 安装包尚未经 Apple 签名与公证，首次打开请在 Finder 中右键选择“打开”。

![Frakio Work 工作台](docs/assets/frakio-work.png)

## 使用方式

macOS 用户可在 [Releases](https://github.com/MadsGao/frakio-work/releases) 下载 Apple Silicon 或 Intel 版 DMG。设置页会检查 GitHub Releases，有新版时打开对应架构的下载页。

macOS、Windows 和 Linux 都可从源码启动 Web UI。需要 Node.js 24、npm 和 Git；使用 Hermes 功能时还需要本机已安装 Hermes Agent 及其依赖。

```bash
git clone https://github.com/MadsGao/frakio-work.git
cd frakio-work
npm ci
npm run dev
```

Web UI 默认位于 `http://127.0.0.1:5173`，本地 API 位于 `http://127.0.0.1:8787`。用户数据、密钥、日志、Runtime 和备份统一保存在 `~/.frakio-work`，不写入源码仓库。

## 开发与验证

```bash
npm run check:syntax
npm run typecheck
npm test
npm run test:smoke
npm run build
```

项目由 `apps/web`、`apps/api`、`apps/desktop` 和 `packages/contracts` 四个 workspace 组成。详细边界与数据流见 [架构说明](docs/ARCHITECTURE.md)。

## 隐私与上游

匿名使用统计默认关闭。首次启动时只在用户明确同意后才会向 `data.madsgogo.com` 发送经过允许列表清洗的功能事件。不会发送对话、文件内容、项目名、本地路径、密钥或账户资料。

Frakio Work 是独立的第三方项目，不是 Nous Research 官方产品。Hermes Agent 按 MIT 许可证使用，发布包保留上游与第三方依赖的许可文件。

贡献方式见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题见 [SECURITY.md](SECURITY.md)。
