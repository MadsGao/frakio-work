# Frakio Work

[中文](README.md)

Frakio Work is a multi-agent workspace built around Hermes Agent. I have personally used all kinds of Hermes Web UIs and third-party clients on the internet, but none of them really matched my collaboration needs. Also, to be honest, many of the interfaces looked pretty ugly and did not match my taste. That is why Frakio Work was born.
## Quick Setup

If you just want to use Frakio Work directly, the desktop app is recommended. Open [GitHub Releases](https://github.com/MadsGao/frakio-work/releases) and download the DMG that matches your computer architecture. Apple Silicon users should download `arm64`; Intel users should download `x64`. The current macOS installer is not yet Apple-signed or notarized. If macOS says it cannot verify the developer on first launch, right-click Frakio Work in Finder and choose **Open**.

The desktop app includes the Web UI, the local API, and the Runtime files prepared with the package. You do not need to run `npm run dev` manually. When a new version is available, you can check GitHub Releases from the Settings page and open the matching download page.

If you are a developer, or if you are using Windows or Linux, you can start the Web UI from source. You need Node.js 24, npm, and Git. To use Hermes features, you also need a working local Hermes Agent environment, or you can prepare the Runtime through the in-app guide.

```bash
git clone https://github.com/MadsGao/frakio-work.git
cd frakio-work
npm ci
npm run dev
```

After starting from source, the Web UI is available at `http://127.0.0.1:5173`, and the local API is available at `http://127.0.0.1:8787`. User data, credentials, logs, Runtime files, and backups are stored under `~/.frakio-work` and will not be written into the source repository.


---
## Core Idea

The core of Frakio Work is Hermes Agent. In a broad sense, it is a third-party client for Hermes Agent, but because the main focus is deep multi-agent collaboration, another core interaction layer is local Markdown document interaction. At the moment, the recommended setup is Frakio Work + Obsidian.

Deep Obsidian integration is still under development and cannot be fully automated in one click yet. The current way to interact with it still requires manually configuring rule documents in Obsidian. You can also follow my blog madsgogo.life. Before that feature is fully adapted, I will publish related tutorial articles there.
## Future Direction

Frakio Work will continue to grow around the idea of multi-agent collaboration and add more configuration capabilities. In terms of the overall function set, I will keep taking the stitching route. At the moment, it stitches together:

1.  The AI core driver of Hermes Agent
2. Codex's design interface and some dynamic interactions
3. Arc browser's interface color customization and project area switching
4. Some module ideas from Hermes Studio
5. Accio Work's right-side task area structure
6. ...

At the current stage, my own evaluation of Frakio Work in actual use is that it is a superior experience.
## Features
### Quick Multi-Agent Conversation Entry
#### New Conversation

[Watch the Frakio Work main interface demo](https://github.com/MadsGao/frakio-work/releases/download/v0.1.2/frakio-work-main-demo.mp4)

1. Click the @ above the input box to talk to any configured Agent at any time.
2. Type @ in the input box to call up another Agent at any time, either to start a conversation or inherit a conversation.
3. The lower-right corner of the input box adds model switching, so you can switch the model for the current Agent at any time. This does not affect the Agent's global default model and only takes effect in the current session.
#### Conversation Interface - Summon With @ At Any Time

![CleanShot 2026-07-19 at 13.19.33@2x.png](docs/assets/readme/chat-mention.png)

During a conversation, you can freely type @ to summon other Agents into the conversation.
#### Conversation Follow Mode Switching

![CleanShot 2026-07-19 at 13.24.10@2x.png](docs/assets/readme/conversation-follow.png)

At the top of the conversation, you can set the multi-agent mode for the current conversation:
1. Default follow: when you do not @ another Agent, the next reply will be handled by the global default Agent. The global default Agent can be set in the Agent configuration center.
2. Conversation follow: when the user @ mentions an Agent, the following conversation will be taken over by that Agent.
3. Convert to project: if this conversation needs to become a project, you can convert it to a project, and it will automatically be added to the project area of the current workspace.
4. Knowledge vault (in development): link a local Obsidian vault and call the rule index from the corresponding Obsidian vault to enable deep multi-agent collaboration.
#### Quick Conversation Index

![CleanShot 2026-07-19 at 13.53.04@2x.png](docs/assets/readme/quick-index.png)

A quick jump index has been added during conversations. It recreates Codex's quick conversation index and is useful when there are too many messages and you need to jump quickly.
## Left And Right Sidebars

[Watch the Frakio Work left and right sidebar demo](https://github.com/MadsGao/frakio-work/releases/download/v0.1.2/frakio-work-sidebars-demo.mp4)

This recreates Codex's smooth dynamic left and right sidebar interactions, and the right sidebar configuration also references Accio Work's layout.
## Settings Improvements
### Fast Agent Configuration Center

![CleanShot 2026-07-19 at 12.54.15@2x.png](docs/assets/readme/agent-config-center.png)

1. Scattered Agent settings are collected into one place and displayed as cards for easier management.
2. Agent avatars can be customized.
3. A default Agent is added. The default Agent is Frakio Work's global default Agent, meaning it is the default reply Agent when the user does not specify any Agent. It acts as the butler model.
4. Agent default models are added, meaning the default model used when the user does not specify a model for that Agent.
### Model Configuration

![CleanShot 2026-07-19 at 13.28.46@2x.png](docs/assets/readme/model-config.png)

Configure a model once, and multiple Agents can share it. I developed this module because in Hermes Agent and other third-party usage flows, each Agent has to be configured separately, which feels repetitive.
### Monitoring Beautification

![CleanShot 2026-07-19 at 13.31.05@2x.png](docs/assets/readme/monitor-dashboard.png)

Because the original one was too ugly, I made a visual beautification, referencing the CC Switch Token monitoring panel.
### Personal Profile

![CleanShot 2026-07-19 at 13.32.57@2x.png](docs/assets/readme/profile.png)

A personal profile page has been added, referencing Codex's personal profile page. There should always be a stats panel to show off your AI usage process. You can customize your own conversation avatar, and that avatar will appear on the loading welcome page and in conversations.
### Obsidian Vault (In Development)

![CleanShot 2026-07-19 at 13.34.13@2x.png](docs/assets/readme/obsidian-vault.png)

This is a key point for deep multi-agent collaboration. Only when each Agent's working interaction files actually interact locally can precise collaboration be achieved, instead of relying on context or cross-session context guessing. The development direction is to switch between different vaults and reference the rule indexes in those vaults, so different large-scale operations projects can be operated precisely.
### Multi-Workspace Concept

![CleanShot 2026-07-19 at 13.37.55@2x.png](docs/assets/readme/workspaces.png)

This idea comes from Arc's workspace classification concept. In actual use, for example, there can be one workspace for project development, one for media operations, one for casual conversations, and one for independent site operations.

Putting all conversations in the same workspace makes them hard to view and categorize, so I came up with this idea. Also, to distinguish different workspaces, I recreated custom theme colors for different workspaces. You can set the workspace name, icon, and color.

Colors can be a single color or a gradient of up to three colors, with freely adjustable brightness and noise.
## Ending

That is everything about the new and optimized modules in Frakio Work. Everyone is very welcome to try it. If you run into any problems, you can add the author's WeChat, MadsGao, and discuss future optimization directions together.
