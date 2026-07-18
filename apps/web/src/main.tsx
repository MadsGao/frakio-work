import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AppUpdateStatus } from '@frakio/contracts';
import { createRoot } from 'react-dom/client';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  ArrowLeft,
  ArrowDownToLine,
  ArrowUp,
  ArrowUpFromLine,
  Archive,
  Bot,
  Boxes,
  Briefcase,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock3,
  Code2,
  Database,
  ExternalLink,
  File,
  FileText,
  Folder,
  FolderOpen,
  Hand,
  Image,
  Library,
  LoaderCircle,
  MessageSquare,
  MoreHorizontal,
  Network,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  PanelRightOpen,
  Pencil,
  PauseCircle,
  Plus,
  RefreshCw,
  Search,
  Send,
  ShieldAlert,
  Settings,
  ShieldCheck,
  Sparkles,
  Square,
  Sun,
  Moon,
  Trash2,
  UserCircle,
  UserPlus,
  X,
  Zap as ZapIcon,
} from 'lucide-react';
import frakioBrandLogoUrl from './assets/frakio-brand-logo.png';
import { installLocalApiFetchGuard } from './api/fetch-guard';
import './styles.css';

installLocalApiFetchGuard();

declare global {
  interface Window {
    frakioDesktop?: {
      restartService?: () => Promise<unknown>;
      openLogs?: () => Promise<unknown>;
      getLoginStartup?: () => Promise<unknown>;
      setLoginStartup?: (enabled: boolean) => Promise<unknown>;
      selectFolder?: () => Promise<{ canceled?: boolean; path?: string; filePaths?: string[] }>;
      windowControl?: (action: 'close' | 'minimize' | 'zoom') => Promise<unknown>;
      showItemInFolder?: (targetPath: string) => Promise<unknown>;
      openRelease?: (targetUrl: string) => Promise<{ ok?: boolean }>;
    };
  }
}

type ProfileModuleUsage = { useCount?: number; viewCount?: number; patchCount?: number; state?: string; lastUsedAt?: string | null };
type ProfileModuleEntry = string | { name: string; file?: string; description?: string; category?: string; enabled?: boolean; status?: string; statusLabel?: string; source?: string; usage?: ProfileModuleUsage };
type Agent = { id: string; name: string; role: string; model: string; color: string; soul: string; scope: string; profileName?: string; gatewayStatus?: string; source?: string; soulExcerpt?: string; userProfileExcerpt?: string; memoryExcerpt?: string; userProfile?: string; memory?: string; providerSummary?: HermesProviderSummary[]; skills?: ProfileModuleEntry[]; plugins?: ProfileModuleEntry[]; avatarUrl?: string };
type ModelKind = 'official' | 'relay' | 'local';
type ModelProtocol = 'OpenAI Compatible' | 'Anthropic Compatible' | 'Custom';
type ProviderApiMode = 'chat_completions' | 'codex_responses' | 'anthropic_messages' | 'bedrock_converse' | 'codex_app_server' | '';
type ProviderAuthType = 'codex-device' | 'claude-pkce' | 'gemini-loopback';
type ModelPricing = { input: number | null; output: number | null; cacheRead: number | null; cacheCreation: number | null };
type ModelPayload = { name: string; provider: string; kind: ModelKind; protocol: ModelProtocol; model: string; models: string[]; baseUrl: string; apiKey: string; pricing: ModelPricing; providerKey?: string; apiMode?: ProviderApiMode; contextLimit?: number | null };
type ModelProfile = Omit<ModelPayload, 'apiKey'> & { id: string; hasApiKey: boolean; source?: 'demo' | 'hermes-studio' | 'hermes-profile' | 'manual'; profileName?: string; providerKey?: string; apiMode?: ProviderApiMode; contextLimit?: number | null };
type ProviderPreset = { label: string; value: string; baseUrl: string; models: string[]; builtin: boolean; apiMode?: ProviderApiMode; authType?: ProviderAuthType };
type AuxiliaryModelTask = { key: string; label: string; default_timeout?: number; default_download_timeout?: number };
type AuxiliaryModelSettings = { provider?: string; model?: string; base_url?: string; timeout?: number; download_timeout?: number; extra_body?: Record<string, any> };
type AuxiliaryModelsConfig = Record<string, AuxiliaryModelSettings>;
type MoaModelSlot = { provider: string; model: string };
type MoaPreset = { enabled: boolean; reference_models: MoaModelSlot[]; aggregator: MoaModelSlot; reference_temperature: number | null; aggregator_temperature: number | null; max_tokens: number; reference_max_tokens: number | null; fanout: 'per_iteration' | 'user_turn' };
type MoaConfig = { default_preset: string; active_preset?: string; save_traces: boolean; trace_dir: string; presets: Record<string, MoaPreset>; reference_models: MoaModelSlot[]; aggregator: MoaModelSlot; reference_temperature: number | null; aggregator_temperature: number | null; max_tokens: number; reference_max_tokens: number | null; fanout: 'per_iteration' | 'user_turn'; enabled: boolean };
type VaultDoc = { relativePath: string; name: string; category: string; excerpt?: string };
type Vault = {
  id: string;
  name: string;
  path: string;
  status: string;
  documentCount: number;
  productCount: number;
  lastIndexedAt: string | null;
  needsRefresh: boolean;
};
type VaultSummary = {
  vaultRoot: string;
  vaultExists: boolean;
  documentCount: number;
  categories: Record<string, number>;
  products: string[];
  highSignal: VaultDoc[];
  ruleDocs: VaultDoc[];
  sopDocs: VaultDoc[];
  status: string;
  lastIndexedAt?: string;
  needsRefresh: boolean;
};
type ChatEvent = { id: string; agentId: string; agentName: string; role: string; content: string; reasoning?: string; externalRunId?: string };
type MentionOption = { key: string; type: 'all' | 'agent'; name: string; label: string; description: string; agent?: Agent };
type ChatRunTarget = { kind: 'agent'; agent: Agent } | { kind: 'all'; agent: Agent | null };
type Proposal = { id: string; type: string; title: string; risk: 'low' | 'medium' | 'high'; target: string; status: string };
type WorkArtifact = { id?: string; name: string; kind: string; target?: string; relativePath?: string; path?: string; updatedAt?: string; size?: number };
type WorkspaceFileEntry = { name: string; relativePath: string; kind: 'file' | 'directory'; size?: number; updatedAt?: string; previewable?: boolean };
type WorkspaceFileContent = { name: string; relativePath: string; mimeKind: 'markdown' | 'text' | 'json' | 'code' | 'pdf' | 'image' | 'binary'; content?: string; size: number; updatedAt?: string; truncated: boolean };
type WorkflowStep = { title: string; status: 'pending' | 'running' | 'completed' | 'failed'; source?: 'run' | 'tool' | 'approval' | 'clarify' | 'simulation'; agentName?: string; detail?: string; updatedAt?: string; callId?: string };
type FollowMode = 'default' | 'conversation';
type ThreadCollaboration = { kind: string; activeAgentId?: string | null; lastMentionedAgentId?: string | null; lastMentionedAgentName?: string; maxMentionDepth?: number; lastRoutedAt?: string | null; lastRouteReason?: string };
type ContextPacket = {
  title: string;
  conversation: { userIntent: string; activeAgents: string[]; currentConclusion: string };
  vault: { connected: boolean; documentCount?: number; products?: string[]; activeRules: string[] };
  policy: string;
};
type ThreadMode = 'workspace' | 'direct';
type PermissionMode = 'manual' | 'smart' | 'off';
type AgentModelOverrides = Record<string, string>;
type UserProfile = { avatarUrl: string; nickname: string; bio: string; age: string; hobbies: string; occupation: string; defaultAgentAddress: string; otherAgentAddress: string; completedAt: string; updatedAt: string };
type Thread = {
  id: string;
  spaceId?: string | null;
  workspaceId: string | null;
  mode: ThreadMode;
  primaryAgentId: string | null;
  defaultAgentId?: string | null;
  activeAgentId?: string | null;
  followMode?: FollowMode;
  title: string;
  vaultId: string | null;
  selectedAgents: string[];
  agentModelOverrides?: AgentModelOverrides;
  permissionMode: PermissionMode;
  updatedAt: string;
  workflow: string[];
  workflowState?: WorkflowStep[];
  proposals: Proposal[];
  artifacts?: WorkArtifact[];
  contextPacket: ContextPacket | null;
  messages: ChatEvent[];
  engine?: 'simulate' | 'hermes-studio' | 'model-provider' | 'workspace-group' | 'hermes-agent';
  collaboration?: ThreadCollaboration;
  externalSessionId?: string | null;
  runStatus?: 'idle' | 'running' | 'failed';
  archivedAt?: string | null;
  pinnedAt?: string | null;
};
type ThreadSummary = { id: string; spaceId?: string | null; workspaceId: string | null; workspaceRootPath?: string; title: string; mode: ThreadMode; primaryAgentId: string | null; primaryAgentName?: string; defaultAgentId?: string | null; activeAgentId?: string | null; participantAgentIds: string[]; followMode?: FollowMode; permissionMode?: PermissionMode; agentModelOverrides?: AgentModelOverrides; vaultId: string | null; vaultName: string; updatedAt: string; preview: string; engine?: 'simulate' | 'hermes-studio' | 'model-provider' | 'workspace-group' | 'hermes-agent'; artifactCount?: number; lastArtifactName?: string; runStatus?: 'idle' | 'running' | 'failed'; archivedAt?: string | null; pinnedAt?: string | null };
type CompletedRunSummary = { threadId: string; beforeMessageId: string | null; elapsedSeconds: number };
type ActiveHermesRun = { runId: string; sessionId: string; threadId: string };
type HermesRunTool = { id: string; tool: string; label: string; status: 'running' | 'completed' | 'failed'; duration?: number; toolName?: string; skillName?: string; title?: string; detail?: string; paths?: string[]; fileCount?: number; argsPreview?: string; resultPreview?: string; updatedAt?: string };
type HermesRunApproval = { id?: string; title: string; command: string; cwd?: string; tool?: string };
type HermesRunClarification = { id: string; question: string; choices: string[]; timeoutMs?: number };
type SpaceGradientColor = { id: string; color: string; x: number; y: number; isPrimary?: boolean };
type ThemeHarmony = 'floating' | 'singleAnalogous' | 'complementary' | 'splitComplementary' | 'analogous' | 'triadic';
type ThemePreset = { id: string; page: number; colors: string[]; point: { x: number; y: number }; harmony: ThemeHarmony; type?: 'color' | 'grayscale' };
type SpaceThemeAppearance = 'auto' | 'light' | 'dark';
type SpaceThemePalette = { accentColor: string; sidebarBg: string; opacity: number; noise: number; texture?: number; mode: 'soft' | 'crisp'; gradientColors?: SpaceGradientColor[] };
type SpaceTheme = SpaceThemePalette & { appearance?: SpaceThemeAppearance; lightTheme?: SpaceThemePalette; darkTheme?: SpaceThemePalette };
type SpaceIconKind = 'dot' | 'emoji' | 'icon';
type Space = { id: string; name: string; iconKind: SpaceIconKind; iconValue: string; theme: SpaceTheme; createdAt: string; updatedAt: string; archivedAt?: string | null; lastOpenedAt?: string | null };
type Workspace = { id: string; spaceId?: string | null; name: string; rootPath: string; vaultId: string | null; environment: 'local'; activeThreadId: string | null; createdAt: string; updatedAt: string; archivedAt?: string | null; pinnedAt?: string | null; activeThread?: ThreadSummary | null; threads?: ThreadSummary[] };
type PinnedNav = Record<string, boolean>;
type RailConfirm = { kind: 'thread' | 'workspace'; action: 'delete'; id: string; title: string; x: number; y: number } | null;
type RailContextMenuSource = { kind: 'thread'; thread: ThreadSummary } | { kind: 'workspace'; workspace: Workspace } | { kind: 'space'; space: Space };
type RailContextMenuRect = { left: number; top: number; right: number; bottom: number; width: number; height: number };
type RailContextMenuTarget = RailContextMenuSource & { x: number; y: number; anchorRect?: RailContextMenuRect; sidebarRect?: RailContextMenuRect };
type LaunchPhase = 'booting' | 'connecting' | 'welcome' | 'done';
type FirstUseGuideStepStatus = 'pending' | 'running' | 'ready' | 'failed' | 'skipped';
type FirstUseGuideStatus = 'idle' | 'running' | 'needs-install' | 'ready' | 'failed';
type FirstUseGuideStep = { id: string; label: string; detail: string; status: FirstUseGuideStepStatus };
type FirstUseGuideState = { status: FirstUseGuideStatus; title: string; detail: string; steps: FirstUseGuideStep[]; error: string };
type WorkbenchUiSettings = {
  defaultProfile?: string;
  defaultModel?: string;
  defaultAgentId?: string;
  newChatPrompt?: string;
  sendKey?: 'enter' | 'mod-enter';
  density?: 'comfortable' | 'compact';
  streamingResponses?: boolean;
  showReasoning?: boolean;
  defaultPermissionMode?: PermissionMode;
  contextTriggerTokens?: number;
  groupChatTriggerTokens?: number;
  historyTailMessages?: number;
  libraryCollapsed?: boolean;
  sidebarCollapsed?: boolean;
  sidebarWidth?: number;
  contextWidth?: number;
  activeSpaceId?: string;
  collapsedWorkspaceIds?: string[];
  pinnedNav?: PinnedNav;
  telemetryEnabled?: boolean;
  telemetryNoticeSeenAt?: string;
};
type TelemetryStatus = { enabled: boolean; configured: boolean; queueSize: number; lastSentAt: string | null };
type HermesProviderSummary = { providerKey: string; providerName: string; baseUrl: string; model: string; hasApiKey: boolean; apiKeyState: 'stored' | 'missing' | string };
type HermesProfile = { name: string; path?: string; displayName?: string; model: string; provider: string; contextLimit?: number | null; hasConfig: boolean; hasEnv: boolean; hasAuth: boolean; soulExcerpt?: string; userExcerpt?: string; memoryExcerpt?: string; providers?: HermesProviderSummary[]; skills?: ProfileModuleEntry[]; plugins?: ProfileModuleEntry[]; avatarUrl?: string };
type HermesLocalStatus = {
  studio: { url: string; online: boolean; authMode: string; apiAuthorized: boolean; apiStatus: number; health?: { status?: string; webui_version?: string; gateway?: string; agent_bridge?: { status?: string } } | null };
  profiles: HermesProfile[];
  database: { exists: boolean; rooms: { id: string; name: string; totalTokens: number }[]; sessions: { profile: string; model: string; provider: string; title: string; messageCount: number }[] };
  checkedAt: string;
};
type HermesApiAvailability = 'unknown' | 'online' | 'offline';
type HermesBootstrapStatus = {
  status: 'connected' | 'installed' | 'missing';
  installed: boolean;
  installPath: string;
  sourcePath: string;
  sourceExists: boolean;
  rootConfigExists: boolean;
  api: { online: boolean; apiBaseUrl: string; apiStatus: number; models: string[]; authMode: string };
  profiles: HermesProfile[];
  approval: { profileName: string; configPath: string; mode: PermissionMode; raw?: Record<string, unknown> };
  checkedAt: string;
  nextAction: 'install' | 'start' | 'import';
};
type HermesRuntimeStatus = {
  bridge: { endpoint: string; running: boolean; ready: boolean; status: string; error?: string };
  profiles: HermesProfile[];
  gateways: Array<{ profileName: string; running: boolean; status: string; error?: string }>;
  hermesHome: string;
  frakioWorkHome?: string;
  agentRoot?: string;
  runtime?: HermesRuntimeInfo | null;
  manager?: HermesRuntimeManager | null;
  tools?: Record<string, { command: string; path: string; available: boolean }>;
  lastError?: string;
  autoStart?: {
    status: 'idle' | 'starting' | 'ready' | 'partial' | 'failed';
    startedAt: string | null;
    finishedAt: string | null;
    steps: Array<{ id: string; label: string; status: 'running' | 'ready' | 'failed' | 'skipped'; detail?: string; updatedAt?: string }>;
    logs?: string[];
    error?: string;
  };
  checkedAt: string;
};
type HermesRuntimeInfo = {
  source: 'bundled' | 'managed' | 'override' | string;
  runtimeDir: string;
  pythonRoot: string;
  python: string;
  node?: string;
  version?: string;
  platform?: string;
  bridgeProtocolVersion?: number;
  installedAt?: string;
  active?: boolean;
  verified?: boolean;
  compatible?: boolean;
  manifest?: { sourceTag?: string; sourceCommit?: string; builtAt?: string; hermesAgentVersion?: string } | null;
};
type HermesRuntimeManager = {
  activeRuntime: HermesRuntimeInfo | null;
  bundledRuntime: HermesRuntimeInfo | null;
  managedRuntimes: HermesRuntimeInfo[];
  officialLatest?: { tag?: string; version?: string; releaseDate?: string; label?: string; url?: string; commit?: string } | null;
  registryPath: string;
  managedRoot: string;
  sourcePath: string;
  activeVersion: string;
  previousVersion: string;
  bridgeProtocolVersion: number;
  fallbackReason?: string;
};
type HermesRuntimeDiagnostics = {
  checkedAt: string;
  workbenchApi: { online: boolean; url: string; pid: number; port: number };
  frakioWorkHome?: { path: string; exists: boolean; apiHome?: string; runtimeHome?: string };
  hermesHome: { path: string; exists: boolean; configExists: boolean; profileCount: number; profileNames: string[] };
  agentRoot: { path: string; exists: boolean };
  runtime?: HermesRuntimeStatus['runtime'];
  bridgeScript: { path: string; exists: boolean };
  python: { path: string; exists: boolean };
  tools?: HermesRuntimeStatus['tools'];
  bridge: HermesRuntimeStatus['bridge'];
  runtimeApi: HermesBootstrapStatus['api'];
  profileGateways: HermesRuntimeStatus['gateways'];
  autoStart?: HermesRuntimeStatus['autoStart'];
};
type UpdateModuleStatus = {
  path: string;
  packageVersion?: string;
  isGitRepo: boolean;
  installKind?: 'managed' | 'external' | 'unknown' | 'desktop-release' | 'source';
  currentCommit: string;
  currentBranch: string;
  currentTagDescription?: string;
  displayVersion?: string;
  version?: string;
  releaseDate?: string;
  latestVersion?: string;
  latestReleaseTag?: string;
  latestReleaseUrl?: string;
  remoteUrl: string;
  upstreamCommit: string;
  dirtyFiles: string[];
  dirtyKind?: 'none' | 'install-artifact' | 'source-or-files';
  updateAvailable: boolean;
  canFastForward: boolean;
  blockedReason: string;
  release?: AppUpdateStatus;
};
type HermesBackup = {
  id: string;
  createdAt: string;
  reason: string;
  status: string;
  path: string;
  size?: number;
  before?: { commit?: string; branch?: string; tagDescription?: string; version?: string; releaseDate?: string; displayVersion?: string };
  after?: { commit?: string; branch?: string; tagDescription?: string; version?: string; releaseDate?: string; displayVersion?: string } | null;
  dirtyFiles?: string[];
  patchSaved?: boolean;
  untrackedFiles?: string[];
  configFiles?: string[];
};
type UpdatesStatus = {
  checkedAt: string;
  hermesAgent: UpdateModuleStatus;
  frakioWork: UpdateModuleStatus;
  backups?: HermesBackup[];
  backupRoot?: string;
};
type UpdateActionResult = {
  ok?: boolean;
  target?: 'all' | 'hermes-agent' | 'frakio-work';
  phase?: string;
  logs?: string[];
  status?: UpdatesStatus | null;
  error?: string;
  restartRequired?: boolean;
  backup?: HermesBackup;
  currentBackup?: HermesBackup;
  restoredConfig?: string[];
  deleted?: string | string[];
  bootstrap?: HermesBootstrapStatus;
  runtime?: HermesRuntimeStatus;
};
type UpdateBusy = 'check' | 'runtime-check' | 'runtime-install' | 'runtime-bundled' | 'hermes-agent' | 'frakio-work' | 'backup' | `runtime-activate:${string}` | `runtime-delete:${string}` | `rollback:${string}` | `delete:${string}` | `cleanup:${string}` | '';
type RollbackScopes = { profiles?: boolean; mcp?: boolean; channels?: boolean; models?: boolean };
type HermesConfig = {
  display?: Record<string, any>;
  agent?: Record<string, any>;
  memory?: Record<string, any>;
  skills?: Record<string, any>;
  compression?: Record<string, any>;
  session_reset?: Record<string, any>;
  approvals?: Record<string, any>;
  proxy?: Record<string, any>;
  gatewayAutoStart?: Record<string, any>;
  platforms?: Record<string, Record<string, any>>;
  [key: string]: any;
};
type HermesJob = {
  id: string;
  job_id: string;
  name: string;
  prompt: string;
  prompt_preview?: string;
  schedule_display: string;
  enabled: boolean;
  state: string;
  deliver: string;
  skills: string[];
  next_run_at: string | null;
  last_run_at: string | null;
  last_status: string | null;
  last_error: string | null;
};
type UserProfileAgentUsage = { id: string; name: string; role?: string; color?: string; avatarUrl?: string; profileName?: string; conversationCount: number; messageCount: number; lastUsedAt?: string | null };
type UserProfileModuleUsage = { name: string; category?: string; profiles?: number; enabledProfiles?: number; useCount: number; viewCount: number; patchCount: number; lastUsedAt?: string | null };
type UserProfileSummary = {
  checkedAt: string;
  userProfile?: UserProfile;
  stats: { totalTokens: number; peakDayTokens: number; peakDay: string; requests: number; conversations: number; activeAgents: number };
  usage: { byDay: UsageDay[]; entries: UsageEntry[] };
  agents: UserProfileAgentUsage[];
  modules: {
    skills: { byName: UserProfileModuleUsage[] };
    plugins: { byName: UserProfileModuleUsage[] };
  };
};
type McpServer = {
  name: string;
  transport: 'stdio' | 'http';
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  auth?: string;
  enabled: boolean;
  status: string;
  statusLabel: string;
  tools: string[];
  toolCount: number;
  availableToolCount?: number;
  timeout?: number | null;
  connectTimeout?: number | null;
  filter?: Record<string, any>;
  error?: string;
};
type McpServersPayload = {
  profile: string;
  configPath: string;
  servers: McpServer[];
  stats: { total: number; connected: number; disconnected: number; tools: number };
  runtime?: { bridgeReady?: boolean; lastError?: string };
};
type McpFormState = {
  name: string;
  transport: 'stdio' | 'http';
  command: string;
  argsText: string;
  envText: string;
  url: string;
  headersText: string;
  auth: string;
  enabled: boolean;
};
type KanbanTaskStatus = 'triage' | 'todo' | 'scheduled' | 'ready' | 'running' | 'blocked' | 'review' | 'done' | 'archived';
type KanbanTask = {
  id: string;
  title: string;
  body?: string | null;
  assignee?: string | null;
  status: KanbanTaskStatus;
  priority?: number;
  created_at?: number;
  tenant?: string | null;
  result?: string | null;
  skills?: string[] | null;
};
type KanbanBoard = {
  slug: string;
  name: string;
  icon?: string;
  total?: number;
  counts?: Record<string, number>;
  archived?: boolean;
};
type MonitoringLog = { source: string; file?: string; level: 'info' | 'warn' | 'error' | string; message: string };
type ModelUsageRow = { key: string; provider: string; modelId: string; modelName: string; requests: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number; realTotalTokens: number; totalCost: number; pricing?: ModelPricing & { source?: string }; pricingSource?: string; estimatedRequests: number; lastUsedAt?: string | null; dataSources?: Record<string, number> };
type UsageEntry = { id?: string; createdAt?: string; provider: string; modelId: string; modelName: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number; realTotalTokens: number; totalCost: number; pricing?: ModelPricing & { source?: string }; pricingSource?: string; estimated?: boolean; dataSource?: string; threadTitle?: string; agentNames?: string[]; profileName?: string };
type UsageDay = { day: string; requests: number; totalTokens: number; realTotalTokens: number; totalCost: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number };
type UsageSource = { source: string; requests: number; totalTokens: number; realTotalTokens: number; totalCost: number };
type UsageProfile = { profileName: string; requests: number; totalTokens: number; realTotalTokens: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalCost: number };
type UsageRangeMode = 'today' | '7' | '15' | '30' | '90' | '180' | '365';
type AnalysisTab = 'cost' | 'trend' | 'requests' | 'ranking';
type UsageTrendPoint = { key: string; label: string; requests: number; inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; realTotalTokens: number; cost: number };
type ModelMetricRow = { key: string; provider: string; modelName: string; requests: number; realTotalTokens: number; totalCost: number; share: number; color: string };
type DonutMetricRow = { key: string; modelName: string; requests: number; realTotalTokens: number; totalCost: number; share: number; displayShare: number; color: string };
type ModuleUsageRow = { name: string; category?: string; profiles?: number; enabledProfiles?: number; useCount: number; viewCount: number; patchCount: number; lastUsedAt?: string | null };
type MonitoringSummary = {
  checkedAt: string;
  logs: MonitoringLog[];
  usage: { totalRequests: number; totalTokens: number; realTotalTokens: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalCost: number; cacheHitRate: number; estimatedRequests: number; byModel: ModelUsageRow[]; byDay: UsageDay[]; bySource: UsageSource[]; byProfile?: UsageProfile[]; entries?: UsageEntry[]; recent: Array<ModelUsageRow & { createdAt?: string; agentNames?: string[]; threadTitle?: string }> };
  hermesStudio?: { databaseExists: boolean; roomCount: number; sessionCount: number; usageRowCount?: number; usageSource?: string };
  hermesAgent?: { databaseCount: number; usageRowCount: number; usageSource: string; profiles: Array<{ profileName: string; dbPath: string; sessionCount: number }> };
  modules: { skills: { total: number; enabled: number; byName: ModuleUsageRow[] }; plugins: { total: number; enabled: number; byName: ModuleUsageRow[] } };
};
type ProfileEditableKind = 'notes' | 'user' | 'soul' | 'skill';
type ProfileInspectorTarget = {
  agentId: string;
  agentName: string;
  profileName: string;
  kind: ProfileEditableKind;
  title: string;
  moduleName?: string;
};
type ProfileInspectorState = {
  target: ProfileInspectorTarget | null;
  draft: string;
  original: string;
  loading: boolean;
  saving: boolean;
  error: string;
  errorStage: '' | 'load' | 'save';
  saved: boolean;
};
type ProfileEditorControls = {
  state: ProfileInspectorState;
  dirty: boolean;
  open: (target: ProfileInspectorTarget) => Promise<void>;
  changeDraft: (draft: string) => void;
  save: () => Promise<void>;
  close: () => boolean;
  discard: () => boolean;
};

const workspaceId = 'workspace_default';
const defaultProjectParentPath = '';
const defaultSidebarWidth = 240;
const defaultContextWidth = 344;
const autoCollapseSidebarWidth = 1160;
const autoCollapseSidebarWithRightRailWidth = 1221;
const sidebarWidthBounds = { min: 240, max: 420 };
const contextWidthBounds = { min: 280, max: 520 };
const threadFollowThreshold = 96;
const launchUserAvatarSnapshotKey = 'frakio-work.launchUserAvatarSnapshot';
const firstUseGuideStorageKey = 'frakio-work.firstUseGuideCompleted';
const navItems = [
  { id: 'council', label: '新对话', icon: MessageSquare, placement: 'system' },
  { id: 'knowledge', label: '知识问答', icon: Library, placement: 'hidden' },
  { id: 'channels', label: '频道', icon: MessageSquare, placement: 'settings' },
  { id: 'plugins', label: '插件中心', icon: Boxes, placement: 'settings' },
  { id: 'kanban', label: '看板', icon: Boxes, placement: 'rail' },
  { id: 'jobs', label: '定时任务', icon: Clock3, placement: 'settings' },
  { id: 'monitoring', label: '监控', icon: Activity, placement: 'settings' },
  { id: 'models', label: '模型配置', icon: Bot, placement: 'settings' },
  { id: 'org', label: 'Agent 配置', icon: Network, placement: 'hidden' },
  { id: 'settings', label: '设置', icon: Settings, placement: 'system' },
];
const railNavItems = navItems.filter((item) => item.placement === 'rail');
const managementNavIds = new Set(['settings', 'org', 'models', 'channels', 'plugins', 'kanban', 'jobs', 'monitoring']);
const defaultProductSpaceTheme: SpaceThemePalette = {
  accentColor: '#dce8e3',
  sidebarBg: '#f3f7f5',
  opacity: 0.74,
  noise: 0.01,
  texture: 0.03,
  mode: 'soft',
  gradientColors: [{ id: 'primary', color: '#dce8e3', x: 0.5, y: 0.5, isPrimary: true }],
};
const zenPresetPositions = [[240, 240], [233, 157], [236, 111], [234, 173], [220, 187], [225, 237], [147, 195], [81, 84]] as const;
const zenPoint = ([x, y]: readonly [number, number]) => ({ x: x / 360, y: y / 360 });
const zenPresetPage = (page: number, prefix: string, palettes: string[][], harmony: ThemeHarmony): ThemePreset[] => palettes.map((colors, index) => ({
  id: `zen-${prefix}-${index + 1}`,
  page,
  colors,
  point: zenPoint(zenPresetPositions[index]),
  harmony,
}));
const themePresets: ThemePreset[] = [
  ...zenPresetPage(0, 'light-solid', [
    ['#f4efdf'], ['#f0b8cd'], ['#e9c3e3'], ['#da7682'], ['#eb8570'], ['#dcce7f'], ['#5becad'], ['#919bb5'],
  ], 'floating'),
  ...zenPresetPage(1, 'light-gradient', [
    ['#f5edd6', '#ddf3d8', '#f3d8e1'], ['#f3bede', '#f7deba', '#dfc3ee'], ['#e5b3e4', '#ecacb2', '#c5b9df'], ['#eb7a9f', '#efef76', '#d285e0'],
    ['#f2737b', '#aff273', '#e67de8'], ['#ddcd55', '#61d45e', '#d75b7c'], ['#4be7d2', '#54afde', '#3ef470'], ['#7a849e', '#8975a4', '#74a2a4'],
  ], 'analogous'),
  ...zenPresetPage(2, 'dark-solid', [
    ['#5d566a'], ['#997096'], ['#956066'], ['#9c6645'], ['#517b6c'], ['#576e75'], ['#836d5f'], ['#447464'],
  ], 'floating'),
  ...zenPresetPage(3, 'dark-gradient', [
    ['#171122', '#250e23', '#121621'], ['#804c7c', '#8d3f42', '#615874'], ['#7a3840', '#7e7934', '#6f446e'], ['#834116', '#408019', '#7a1f5b'],
    ['#2d6c55', '#345565', '#347623'], ['#2d4a53', '#2e3251', '#265a41'], ['#402f26', '#374026', '#3b2b34'], ['#16503d', '#1a3c4c', '#1b570f'],
  ], 'analogous'),
  ...[28, 33, 64, 97, 128, 161, 191, 224, 255].map((value, index): ThemePreset => ({
    id: `zen-grayscale-${index + 1}`,
    page: 4,
    colors: [`#${value.toString(16).padStart(2, '0').repeat(3)}`],
    point: { x: [340, 337.5, 315, 292.5, 270, 247.5, 225, 202.5, 180][index] / 360, y: 0.5 },
    harmony: 'floating',
    type: 'grayscale',
  })),
];
const themePresetPages = Array.from({ length: 5 }, (_, page) => themePresets.filter((preset) => preset.page === page));
const spaceEmojiOptions = ['✨', '💼', '🧠', '🚀', '🌿', '🎨', '📚', '🧩', '🛠️', '🪐', '🔥', '💎'];
const spaceIconOptions = ['folder', 'briefcase', 'sparkles', 'library'];
const spaceIconLabels: Record<string, string> = {
  folder: 'Folder',
  briefcase: 'Briefcase',
  sparkles: 'Sparkles',
  library: 'Library',
};

function App() {
  const isDesktopShell = Boolean(window.frakioDesktop);
  const canSelectFolder = Boolean(window.frakioDesktop?.selectFolder);
  const [activeNav, setActiveNav] = useState('council');
  const [agents, setAgents] = useState<Agent[]>([]);
  const [models, setModels] = useState<ModelProfile[]>([]);
  const [vaults, setVaults] = useState<Vault[]>([]);
  const [defaultVaultId, setDefaultVaultId] = useState<string | null>(null);
  const [vaultSummary, setVaultSummary] = useState<VaultSummary | null>(null);
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [activeSpaceId, setActiveSpaceId] = useState('space_default');
  const [spaceMenuOpen, setSpaceMenuOpen] = useState(false);
  const [spaceCreateOpen, setSpaceCreateOpen] = useState(false);
  const [spaceEditTargetId, setSpaceEditTargetId] = useState<string | null>(null);
  const [spaceSwitchDirection, setSpaceSwitchDirection] = useState<'left' | 'right' | 'none'>('none');
  const [spaceDraft, setSpaceDraft] = useState({ name: '', iconKind: 'dot' as SpaceIconKind, iconValue: '', theme: buildSpaceThemeFromPoint(0.18, 0.72, '#536006', 'soft' as const) });
  const [spaceColorPoint, setSpaceColorPoint] = useState({ x: 0.18, y: 0.72 });
  const [themePresetPage, setThemePresetPage] = useState(0);
  const [selectedThemePresetId, setSelectedThemePresetId] = useState<string | null>(null);
  const [themeHarmony, setThemeHarmony] = useState<ThemeHarmony>('floating');
  const themeDragColorRef = useRef<string | null>(null);
  const themeDragMovedRef = useRef(false);
  const themeDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const textureDragRef = useRef(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [conversations, setConversations] = useState<ThreadSummary[]>([]);
  const [activeThread, setActiveThread] = useState<Thread | null>(null);
  const [workspaceArtifacts, setWorkspaceArtifacts] = useState<WorkArtifact[]>([]);
  const [activeView, setActiveView] = useState<'thread' | 'new-chat'>('new-chat');
  const [input, setInput] = useState('');
  const [newChatInput, setNewChatInput] = useState('');
  const [newChatAgentId, setNewChatAgentId] = useState('');
  const [newChatModelOverride, setNewChatModelOverride] = useState('');
  const [newChatAgentPickerOpen, setNewChatAgentPickerOpen] = useState(false);
  const [newChatPermissionMode, setNewChatPermissionMode] = useState<PermissionMode>('manual');
  const [selectedNewChatWorkspaceId, setSelectedNewChatWorkspaceId] = useState<string | null>(null);
  const [projectPickerOpen, setProjectPickerOpen] = useState(false);
  const [attachments, setAttachments] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const threadScrollRef = useRef<HTMLDivElement | null>(null);
  const threadContentRef = useRef<HTMLDivElement | null>(null);
  const threadBottomRef = useRef<HTMLDivElement | null>(null);
  const threadScrollFrameRef = useRef<number | null>(null);
  const threadProgrammaticScrollRef = useRef(false);
  const threadProgrammaticScrollTimerRef = useRef<number | null>(null);
  const threadUserScrollIntentRef = useRef(false);
  const threadUserScrollIntentTimerRef = useRef<number | null>(null);
  const isFollowingLatestRef = useRef(true);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const [hasNewThreadContent, setHasNewThreadContent] = useState(false);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [activeOverviewRoundId, setActiveOverviewRoundId] = useState('');
  const [agentPickerOpen, setAgentPickerOpen] = useState(false);
  const [agentModelEditorId, setAgentModelEditorId] = useState<string | null>(null);
  const [projectModalOpen, setProjectModalOpen] = useState(false);
  const [projectModalPurpose, setProjectModalPurpose] = useState<'create' | 'convert'>('create');
  const [projectMode, setProjectMode] = useState<'create' | 'existing'>('create');
  const [projectName, setProjectName] = useState('');
  const [projectRootPath, setProjectRootPath] = useState('');
  const [projectParentPath, setProjectParentPath] = useState(defaultProjectParentPath);
  const [projectError, setProjectError] = useState('');
  const [railConfirm, setRailConfirm] = useState<RailConfirm>(null);
  const [railContextMenu, setRailContextMenu] = useState<RailContextMenuTarget | null>(null);
  const [archivedThreads, setArchivedThreads] = useState<ThreadSummary[]>([]);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('hermes');
  const [libraryCollapsed, setLibraryCollapsed] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarManuallyExpanded, setSidebarManuallyExpanded] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [sidebarWidth, setSidebarWidth] = useState(defaultSidebarWidth);
  const [contextWidth, setContextWidth] = useState(defaultContextWidth);
  const [pinnedNav, setPinnedNav] = useState<PinnedNav>(() => Object.fromEntries(railNavItems.map((item) => [item.id, true])));
  const [userProfile, setUserProfile] = useState<UserProfile>({ avatarUrl: '', nickname: '', bio: '', age: '', hobbies: '', occupation: '', defaultAgentAddress: '', otherAgentAddress: '', completedAt: '', updatedAt: '' });
  const [userProfileLoaded, setUserProfileLoaded] = useState(false);
  const [uiSettings, setUiSettings] = useState<WorkbenchUiSettings>({ sendKey: 'enter', density: 'comfortable', streamingResponses: true, showReasoning: true, defaultAgentId: 'iris', defaultPermissionMode: 'manual', contextTriggerTokens: 500000, groupChatTriggerTokens: 100000, historyTailMessages: 10 });
  const [telemetryStatus, setTelemetryStatus] = useState<TelemetryStatus | null>(null);
  const [showTelemetryNotice, setShowTelemetryNotice] = useState(false);
  const [hermesStatus, setHermesStatus] = useState<HermesLocalStatus | null>(null);
  const [hermesBootstrap, setHermesBootstrap] = useState<HermesBootstrapStatus | null>(null);
  const [hermesRuntime, setHermesRuntime] = useState<HermesRuntimeStatus | null>(null);
  const [hermesDiagnostics, setHermesDiagnostics] = useState<HermesRuntimeDiagnostics | null>(null);
  const [hermesApiAvailability, setHermesApiAvailability] = useState<HermesApiAvailability>('unknown');
  const [hermesError, setHermesError] = useState('');
  const [updatesStatus, setUpdatesStatus] = useState<UpdatesStatus | null>(null);
  const [updatesBusy, setUpdatesBusy] = useState<UpdateBusy>('');
  const [updatesError, setUpdatesError] = useState('');
  const [updatesResult, setUpdatesResult] = useState<UpdateActionResult | null>(null);
  const [isImportingHermes, setIsImportingHermes] = useState(false);
  const [vaultPathInput, setVaultPathInput] = useState('');
  const [vaultError, setVaultError] = useState('');
  const [vaultBusy, setVaultBusy] = useState<Record<string, 'index' | 'delete'>>({});
  const [modelError, setModelError] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [runTarget, setRunTarget] = useState<ChatRunTarget | null>(null);
  const [runTick, setRunTick] = useState(0);
  const [activeHermesRun, setActiveHermesRun] = useState<ActiveHermesRun | null>(null);
  const [runDraft, setRunDraft] = useState('');
  const [runTools, setRunTools] = useState<HermesRunTool[]>([]);
  const [runApproval, setRunApproval] = useState<HermesRunApproval | null>(null);
  const [approvalSubmitting, setApprovalSubmitting] = useState(false);
  const [approvalError, setApprovalError] = useState('');
  const [runClarification, setRunClarification] = useState<HermesRunClarification | null>(null);
  const [clarificationSubmitting, setClarificationSubmitting] = useState(false);
  const [clarificationError, setClarificationError] = useState('');
  const [runError, setRunError] = useState('');
  const [runStopping, setRunStopping] = useState(false);
  const [completedRunSummary, setCompletedRunSummary] = useState<CompletedRunSummary | null>(null);
  const [animatedMessageContent, setAnimatedMessageContent] = useState<Record<string, string>>({});
  const [streamingMessageIds, setStreamingMessageIds] = useState<Record<string, boolean>>({});
  const [newAgentOpen, setNewAgentOpen] = useState(false);
  const [selectedOrgAgentId, setSelectedOrgAgentId] = useState('max');
  const [editingAgentId, setEditingAgentId] = useState<string | null>(null);
  const [profileInspector, setProfileInspector] = useState<ProfileInspectorState>({ target: null, draft: '', original: '', loading: false, saving: false, error: '', errorStage: '', saved: false });
  const profileInspectorRequestRef = useRef(0);
  const [launchPhase, setLaunchPhase] = useState<LaunchPhase>('booting');
  const [launchUserAvatarSnapshot, setLaunchUserAvatarSnapshot] = useState(() => readLaunchUserAvatarSnapshot());
  const [firstUseGuide, setFirstUseGuide] = useState<FirstUseGuideState>(() => createFirstUseGuideState());
  const [showFirstUseGuide, setShowFirstUseGuide] = useState(false);
  const launchStartedAtRef = useRef(Date.now());
  const launchTimersRef = useRef<number[]>([]);
  const firstUseGuideAutoStartedRef = useRef(false);

  function isThreadNearLatest(root = threadScrollRef.current) {
    if (!root) return true;
    return root.scrollHeight - root.scrollTop - root.clientHeight <= threadFollowThreshold;
  }

  function setThreadFollowState(following: boolean) {
    isFollowingLatestRef.current = following;
    setIsFollowingLatest(following);
    if (following) setHasNewThreadContent(false);
  }

  function scheduleThreadScrollToLatest() {
    if (threadScrollFrameRef.current !== null) return;
    threadScrollFrameRef.current = window.requestAnimationFrame(() => {
      threadScrollFrameRef.current = null;
      if (!isFollowingLatestRef.current) return;
      const root = threadScrollRef.current;
      if (!root) return;
      root.scrollTop = Math.max(0, root.scrollHeight - root.clientHeight);
      setHasNewThreadContent(false);
    });
  }

  function scrollThreadToLatest(behavior: ScrollBehavior = 'auto') {
    const root = threadScrollRef.current;
    setThreadFollowState(true);
    if (!root) return;
    if (threadScrollFrameRef.current !== null) {
      window.cancelAnimationFrame(threadScrollFrameRef.current);
      threadScrollFrameRef.current = null;
    }
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const resolvedBehavior: ScrollBehavior = prefersReducedMotion ? 'auto' : behavior;
    threadProgrammaticScrollRef.current = resolvedBehavior === 'smooth';
    root.scrollTo({ top: root.scrollHeight, behavior: resolvedBehavior });
    if (threadProgrammaticScrollTimerRef.current !== null) window.clearTimeout(threadProgrammaticScrollTimerRef.current);
    threadProgrammaticScrollTimerRef.current = window.setTimeout(() => {
      threadProgrammaticScrollRef.current = false;
      threadProgrammaticScrollTimerRef.current = null;
      if (isThreadNearLatest()) setThreadFollowState(true);
    }, resolvedBehavior === 'smooth' ? 520 : 0);
  }

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => () => {
    for (const timer of launchTimersRef.current) window.clearTimeout(timer);
    launchTimersRef.current = [];
  }, []);

  useEffect(() => {
    if (launchPhase !== 'connecting') return undefined;
    const status = hermesRuntime?.autoStart?.status;
    if (status && status !== 'starting') {
      scheduleLaunchWelcome();
      return undefined;
    }
    const poller = window.setInterval(() => {
      void refreshHermesRuntime();
    }, 900);
    const timeout = window.setTimeout(() => {
      scheduleLaunchWelcome();
    }, Math.max(0, 8000 - (Date.now() - launchStartedAtRef.current)));
    return () => {
      window.clearInterval(poller);
      window.clearTimeout(timeout);
    };
  }, [launchPhase, hermesRuntime?.autoStart?.status]);

  useEffect(() => {
    if (activeThread?.vaultId) void loadVaultSummary(activeThread.vaultId);
    if (activeThread && !activeThread.vaultId) setVaultSummary(null);
  }, [activeThread?.vaultId]);

  useEffect(() => {
    if (activeThread?.mode === 'workspace' && activeThread.workspaceId) void loadWorkspaceArtifacts(activeThread.workspaceId);
    if (activeThread?.mode !== 'workspace') setWorkspaceArtifacts([]);
  }, [activeThread?.id, activeThread?.workspaceId, activeThread?.mode, activeThread?.messages.length]);

  useLayoutEffect(() => {
    if (activeView !== 'thread') return;
    threadProgrammaticScrollRef.current = false;
    setThreadFollowState(true);
    scheduleThreadScrollToLatest();
  }, [activeView, activeThread?.id]);

  useEffect(() => {
    if (activeView !== 'thread') return;
    if (isFollowingLatestRef.current) scheduleThreadScrollToLatest();
    else setHasNewThreadContent(true);
  }, [
    activeView,
    activeThread?.id,
    activeThread?.messages.length,
    isRunning,
    runDraft,
    runError,
    runTools,
    animatedMessageContent,
    streamingMessageIds,
    completedRunSummary,
  ]);

  useEffect(() => {
    const root = threadScrollRef.current;
    const content = threadContentRef.current;
    if (activeView !== 'thread' || !root || !content) return undefined;

    const clearUserIntentTimer = () => {
      if (threadUserScrollIntentTimerRef.current !== null) {
        window.clearTimeout(threadUserScrollIntentTimerRef.current);
        threadUserScrollIntentTimerRef.current = null;
      }
    };
    const markUserScrollIntent = () => {
      threadProgrammaticScrollRef.current = false;
      threadUserScrollIntentRef.current = true;
      clearUserIntentTimer();
      threadUserScrollIntentTimerRef.current = window.setTimeout(() => {
        threadUserScrollIntentRef.current = false;
        threadUserScrollIntentTimerRef.current = null;
      }, 420);
    };
    const handlePointerDown = () => {
      threadProgrammaticScrollRef.current = false;
      threadUserScrollIntentRef.current = true;
      clearUserIntentTimer();
    };
    const handlePointerUp = () => {
      threadUserScrollIntentTimerRef.current = window.setTimeout(() => {
        threadUserScrollIntentRef.current = false;
        threadUserScrollIntentTimerRef.current = null;
      }, 80);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) markUserScrollIntent();
    };
    const handleScroll = () => {
      if (threadProgrammaticScrollRef.current) return;
      if (isThreadNearLatest(root)) {
        setThreadFollowState(true);
        return;
      }
      if (threadUserScrollIntentRef.current) {
        setThreadFollowState(false);
        setHasNewThreadContent(true);
      }
    };
    const handleScrollEnd = () => {
      threadProgrammaticScrollRef.current = false;
      if (isThreadNearLatest(root)) setThreadFollowState(true);
    };
    const resizeObserver = new ResizeObserver(() => {
      if (isFollowingLatestRef.current) scheduleThreadScrollToLatest();
      else if (!isThreadNearLatest(root)) setHasNewThreadContent(true);
    });

    root.addEventListener('scroll', handleScroll, { passive: true });
    root.addEventListener('scrollend', handleScrollEnd);
    root.addEventListener('wheel', markUserScrollIntent, { passive: true });
    root.addEventListener('touchstart', markUserScrollIntent, { passive: true });
    root.addEventListener('pointerdown', handlePointerDown, { passive: true });
    window.addEventListener('pointerup', handlePointerUp, { passive: true });
    window.addEventListener('keydown', handleKeyDown);
    resizeObserver.observe(root);
    resizeObserver.observe(content);
    return () => {
      root.removeEventListener('scroll', handleScroll);
      root.removeEventListener('scrollend', handleScrollEnd);
      root.removeEventListener('wheel', markUserScrollIntent);
      root.removeEventListener('touchstart', markUserScrollIntent);
      root.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('keydown', handleKeyDown);
      resizeObserver.disconnect();
      clearUserIntentTimer();
    };
  }, [activeView, activeThread?.id]);

  useEffect(() => () => {
    if (threadScrollFrameRef.current !== null) window.cancelAnimationFrame(threadScrollFrameRef.current);
    if (threadProgrammaticScrollTimerRef.current !== null) window.clearTimeout(threadProgrammaticScrollTimerRef.current);
    if (threadUserScrollIntentTimerRef.current !== null) window.clearTimeout(threadUserScrollIntentTimerRef.current);
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setRunTick((tick) => tick + 1), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    function handlePointerDown(event: PointerEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) setUserMenuOpen(false);
    }
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [userMenuOpen]);

  useEffect(() => {
    if (!railContextMenu) return undefined;
    function closeMenu() {
      setRailContextMenu(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeMenu();
    }
    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [railContextMenu]);

  useEffect(() => {
    if (!railConfirm) return undefined;
    function closeConfirm() {
      setRailConfirm(null);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') closeConfirm();
    }
    window.addEventListener('pointerdown', closeConfirm);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', closeConfirm);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [railConfirm]);

  useEffect(() => {
    function handleResize() {
      setViewportWidth(window.innerWidth);
    }
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const globalDefaultAgentId = agents.some((agent) => agent.id === uiSettings.defaultAgentId) ? uiSettings.defaultAgentId || 'iris' : agents.some((agent) => agent.id === 'iris') ? 'iris' : agents[0]?.id || '';
  const selectedAgentIds = activeThread?.selectedAgents?.length ? activeThread.selectedAgents : [globalDefaultAgentId, 'max'].filter(Boolean);
  const permissionMode = activeThread?.permissionMode || 'manual';
  const newChatAgent = agents.find((agent) => agent.id === (newChatAgentId || globalDefaultAgentId)) || agents.find((agent) => agent.id === globalDefaultAgentId) || agents[0] || null;
  const defaultLaunchAgent = agents.find((agent) => agent.id === globalDefaultAgentId) || newChatAgent || agents[0] || null;
  const launchWelcomeAvatarUrl = userProfile.avatarUrl || launchUserAvatarSnapshot || '';
  const activeComposerAgentId = activeThread?.activeAgentId || activeThread?.collaboration?.activeAgentId || activeThread?.defaultAgentId || activeThread?.primaryAgentId || globalDefaultAgentId;
  const activeComposerAgent = agents.find((agent) => agent.id === activeComposerAgentId) || agents[0] || null;
  const localProfilesForComposer = hermesRuntime?.profiles?.length ? hermesRuntime.profiles : hermesBootstrap?.profiles || hermesStatus?.profiles || [];
  const newChatProfileName = resolveHermesProfileNameForAgent(newChatAgent, localProfilesForComposer);
  const activeComposerProfileName = resolveHermesProfileNameForAgent(activeComposerAgent, localProfilesForComposer);
  const defaultAgentProfileName = resolveHermesProfileNameForAgent(agents.find((agent) => agent.id === globalDefaultAgentId) || null, localProfilesForComposer);
  const newChatProfileModelValue = newChatModelOverride || modelValueForHermesProfile(newChatProfileName, localProfilesForComposer, models) || (newChatAgent ? modelValueForAgent(newChatAgent, models, {}, uiSettings.defaultModel) : '');
  const activeThreadModelOverride = activeComposerAgent ? activeThread?.agentModelOverrides?.[activeComposerAgent.id] || '' : '';
  const activeComposerProfileModelValue = activeThreadModelOverride || modelValueForHermesProfile(activeComposerProfileName, localProfilesForComposer, models) || (activeComposerAgent ? modelValueForAgent(activeComposerAgent, models, {}, uiSettings.defaultModel) : '');
  const hermesProfileModelOptions = hermesProfileModels(models);
  const activeVault = vaults.find((vault) => vault.id === activeThread?.vaultId) || null;
  const activeSection = navItems.find((item) => item.id === activeNav);
  const isManagementSection = managementNavIds.has(activeNav);
  const isSettingsNav = activeNav === 'settings' && activeView !== 'new-chat';
  const visiblePinnedNav = railNavItems.filter((item) => pinnedNav[item.id] !== false);
  const activeSpace = spaces.find((space) => space.id === activeSpaceId) || spaces[0] || null;
  const visibleWorkspaces = workspaces.filter((workspace) => (workspace.spaceId || activeSpaceId) === activeSpaceId);
  const visibleConversations = conversations.filter((thread) => (thread.spaceId || activeSpaceId) === activeSpaceId);
  const activeWorkspace = activeThread?.workspaceId ? workspaces.find((workspace) => workspace.id === activeThread.workspaceId) || null : null;
  const visibleMessages = (activeThread?.messages || []).filter(isVisibleChatMessage);
  const overviewRounds = buildThreadOverviewRounds(visibleMessages);
  const activeCompletedRunSummary = completedRunSummary?.threadId === activeThread?.id ? completedRunSummary : null;
  const profileInspectorDirty = Boolean(profileInspector.target && profileInspector.draft !== profileInspector.original);
  const resourceRailAvailable = !spaceCreateOpen && activeView !== 'new-chat' && !isManagementSection && Boolean(activeThread);
  const rightRailKind: 'resources' | null = resourceRailAvailable ? 'resources' : null;
  const rightRailOpen = Boolean(rightRailKind && !libraryCollapsed);
  const profileEditorControls: ProfileEditorControls = {
    state: profileInspector,
    dirty: profileInspectorDirty,
    open: openProfileInspector,
    changeDraft: (draft) => setProfileInspector((current) => ({ ...current, draft, error: current.errorStage === 'save' ? '' : current.error, errorStage: current.errorStage === 'save' ? '' : current.errorStage, saved: false })),
    save: saveProfileInspector,
    close: () => closeProfileInspector(),
    discard: () => closeProfileInspector(true),
  };
  const autoSidebarCollapsed = isDesktopShell && !isSettingsNav && viewportWidth < (rightRailOpen ? autoCollapseSidebarWithRightRailWidth : autoCollapseSidebarWidth);
  const effectiveSidebarCollapsed = sidebarCollapsed || (autoSidebarCollapsed && !sidebarManuallyExpanded);
  const activeSpaceTheme = resolveEffectiveSpaceTheme(activeSpace?.theme);
  const activeSpaceRgb = hexToRgb(activeSpaceTheme.sidebarBg);
  const activeSpaceIsDark = activeSpaceTheme.appearance === 'dark' || (activeSpaceTheme.appearance === 'auto' && isThemeNightTime());
  const appStyle = {
    '--sidebar-width': `${sidebarWidth}px`,
    '--context-width': `${contextWidth}px`,
    '--space-accent': activeSpaceTheme.accentColor,
    '--space-sidebar-bg': activeSpaceTheme.sidebarBg,
    '--space-sidebar-rgb': activeSpaceRgb,
    '--space-sidebar-opacity': String(activeSpaceTheme.opacity),
    '--space-noise-opacity': String(activeSpaceTheme.noise),
    '--space-text': activeSpaceIsDark ? '#f7f4ee' : activeSpaceTheme.mode === 'crisp' ? '#16231f' : '#21332e',
    '--space-muted': activeSpaceIsDark ? '#d1cbc1' : activeSpaceTheme.mode === 'crisp' ? '#53605c' : '#6c7a75',
    '--rail-edge-rgb': activeSpaceIsDark ? '255 255 255' : '17 24 39',
    '--space-shell-bg': themeShellBackground(activeSpaceTheme),
    '--space-stage-bg': themeStageBackground(activeSpaceTheme),
    ...(spaceCreateOpen ? {
      '--draft-shell-bg': themeShellBackground(spaceDraft.theme),
      '--draft-rail-bg': themeRailBackground(spaceDraft.theme),
      '--draft-stage-bg': themeStageBackground(spaceDraft.theme),
    } : {}),
  } as React.CSSProperties;

  useEffect(() => {
    const root = threadScrollRef.current;
    if (!root || !visibleMessages.length || !overviewRounds.length) {
      setActiveOverviewRoundId('');
      return undefined;
    }
    const roundIds = new Set(overviewRounds.map((round) => round.id));
    const messageToRound = new Map<string, string>();
    overviewRounds.forEach((round) => round.messageIds.forEach((messageId) => messageToRound.set(messageId, round.id)));
    setActiveOverviewRoundId((current) => current && roundIds.has(current) ? current : overviewRounds[0]?.id || '');
    const observer = new IntersectionObserver((entries) => {
      const visibleEntry = entries
        .filter((entry) => entry.isIntersecting)
        .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
      const messageId = visibleEntry?.target.getAttribute('data-message-id');
      const roundId = messageId ? messageToRound.get(messageId) : '';
      if (roundId) setActiveOverviewRoundId(roundId);
    }, { root, threshold: [0.2, 0.45, 0.7], rootMargin: '-18% 0px -54% 0px' });
    visibleMessages.forEach((message) => {
      const node = messageRefs.current[message.id];
      if (node) observer.observe(node);
    });
    return () => observer.disconnect();
  }, [activeThread?.id, visibleMessages.length, overviewRounds.length]);

  useEffect(() => {
    if (activeView === 'new-chat' && globalDefaultAgentId && !newChatAgentId) setNewChatAgentId(globalDefaultAgentId);
  }, [activeView, globalDefaultAgentId, newChatAgentId]);

  useEffect(() => {
    if (activeNav === 'settings' && settingsSection === 'archivedThreads') void refreshArchivedThreads();
  }, [activeNav, settingsSection]);

  useEffect(() => {
    if (!userProfileLoaded) return;
    const avatarUrl = String(userProfile.avatarUrl || '').trim();
    setLaunchUserAvatarSnapshot(avatarUrl || null);
    writeLaunchUserAvatarSnapshot(avatarUrl || null);
  }, [userProfileLoaded, userProfile.avatarUrl]);

  async function bootstrap() {
    launchStartedAtRef.current = Date.now();
    setLaunchPhase('booting');
    const safeJson = <T,>(url: string): Promise<T | null> => fetch(url).then((res) => res.json()).catch(() => null);
    const [agentData, modelData, stateData, vaultData, spaceData, workspaceData, conversationData, hermesData, hermesBootstrapData, hermesRuntimeData, hermesDiagnosticsData, updatesData, userProfileData, telemetryData] = await Promise.all([
      safeJson<{ agents: Agent[] }>('/api/agents'),
      safeJson<{ models: ModelProfile[] }>('/api/models'),
      safeJson<{ ui?: WorkbenchUiSettings; integrations?: { hermesStudio?: { selectedProfile?: string } } }>('/api/state'),
      safeJson<{ vaults: Vault[]; defaultVaultId?: string | null }>('/api/vaults'),
      safeJson<{ spaces: Space[]; activeSpaceId?: string | null }>('/api/spaces'),
      safeJson<{ workspaces: Workspace[] }>('/api/workspaces'),
      safeJson<{ conversations: ThreadSummary[] }>('/api/conversations'),
      safeJson<HermesLocalStatus & { error?: string }>('/api/hermes-local/status'),
      safeJson<HermesBootstrapStatus & { error?: string }>('/api/hermes-bootstrap/status'),
      safeJson<HermesRuntimeStatus & { error?: string }>('/api/hermes-runtime/status'),
      safeJson<HermesRuntimeDiagnostics & { error?: string }>('/api/hermes-runtime/diagnostics'),
      safeJson<UpdatesStatus & { error?: string }>('/api/updates/status'),
      safeJson<{ userProfile: UserProfile }>('/api/user-profile'),
      safeJson<TelemetryStatus>('/api/telemetry/status'),
    ]);
    const apiOnline = Boolean(agentData || modelData || stateData || vaultData || spaceData || workspaceData || conversationData || hermesData || hermesBootstrapData || hermesRuntimeData || hermesDiagnosticsData || updatesData || userProfileData);
    if (!apiOnline) {
      setHermesApiAvailability('offline');
      setHermesError('Frakio Work 本地管理服务未运行。请用 npm run dev 同时启动 Web 和 API，或单独运行 npm run dev:api。');
      setActiveThread(null);
      setActiveView('new-chat');
      scheduleLaunchWelcome();
      return;
    }
    setAgents(agentData?.agents || []);
    setModels(modelData?.models || []);
    setLibraryCollapsed(Boolean(stateData?.ui?.libraryCollapsed));
    if (userProfileData?.userProfile) {
      setUserProfile(userProfileData.userProfile);
      setUserProfileLoaded(true);
    }
    setUiSettings({
      sendKey: stateData?.ui?.sendKey || 'enter',
      density: stateData?.ui?.density || 'comfortable',
      streamingResponses: stateData?.ui?.streamingResponses !== false,
      showReasoning: stateData?.ui?.showReasoning !== false,
      defaultProfile: stateData?.ui?.defaultProfile || stateData?.integrations?.hermesStudio?.selectedProfile || 'default',
      defaultModel: stateData?.ui?.defaultModel || '',
      defaultAgentId: stateData?.ui?.defaultAgentId || 'iris',
      newChatPrompt: stateData?.ui?.newChatPrompt || '我们接下来做点什么？',
      defaultPermissionMode: stateData?.ui?.defaultPermissionMode || 'manual',
      contextTriggerTokens: Number(stateData?.ui?.contextTriggerTokens || 500000),
      groupChatTriggerTokens: Number(stateData?.ui?.groupChatTriggerTokens || 100000),
      historyTailMessages: Number(stateData?.ui?.historyTailMessages || 10),
      sidebarCollapsed: Boolean(stateData?.ui?.sidebarCollapsed),
      sidebarWidth: clampNumber(Number(stateData?.ui?.sidebarWidth || defaultSidebarWidth), sidebarWidthBounds.min, sidebarWidthBounds.max),
      contextWidth: clampNumber(Number(stateData?.ui?.contextWidth || defaultContextWidth), contextWidthBounds.min, contextWidthBounds.max),
      activeSpaceId: stateData?.ui?.activeSpaceId || spaceData?.activeSpaceId || spaceData?.spaces?.[0]?.id || 'space_default',
      collapsedWorkspaceIds: Array.isArray(stateData?.ui?.collapsedWorkspaceIds) ? stateData?.ui?.collapsedWorkspaceIds : [],
      telemetryEnabled: stateData?.ui?.telemetryEnabled === true,
      telemetryNoticeSeenAt: stateData?.ui?.telemetryNoticeSeenAt || '',
    });
    if (telemetryData) setTelemetryStatus(telemetryData);
    setShowTelemetryNotice(!stateData?.ui?.telemetryNoticeSeenAt);
    setSidebarCollapsed(Boolean(stateData?.ui?.sidebarCollapsed));
    setSidebarWidth(clampNumber(Number(stateData?.ui?.sidebarWidth || defaultSidebarWidth), sidebarWidthBounds.min, sidebarWidthBounds.max));
    setContextWidth(clampNumber(Number(stateData?.ui?.contextWidth || defaultContextWidth), contextWidthBounds.min, contextWidthBounds.max));
    if (hermesData || hermesBootstrapData || hermesRuntimeData) setHermesApiAvailability('online');
    else {
      setHermesApiAvailability('offline');
      setHermesError('Frakio Work 本地管理服务未运行。请用 npm run dev 同时启动 Web 和 API，或单独运行 npm run dev:api。');
    }
    if (hermesData && !hermesData.error) setHermesStatus(hermesData);
    if (hermesBootstrapData && !hermesBootstrapData.error) setHermesBootstrap(hermesBootstrapData);
    if (hermesRuntimeData && !hermesRuntimeData.error) setHermesRuntime(hermesRuntimeData);
    if (hermesDiagnosticsData && !hermesDiagnosticsData.error) setHermesDiagnostics(hermesDiagnosticsData);
    if (updatesData && !updatesData.error) setUpdatesStatus(updatesData);
    setPinnedNav({ ...Object.fromEntries(railNavItems.map((item) => [item.id, true])), ...(stateData?.ui?.pinnedNav || {}) });
    setVaults(vaultData?.vaults || []);
    setDefaultVaultId(vaultData?.defaultVaultId || null);
    setSpaces(spaceData?.spaces || []);
    setActiveSpaceId(stateData?.ui?.activeSpaceId || spaceData?.activeSpaceId || spaceData?.spaces?.[0]?.id || 'space_default');
    setWorkspaces(workspaceData?.workspaces || []);
    setConversations(conversationData?.conversations || []);
    setActiveThread(null);
    setActiveView('new-chat');
    setNewChatAgentId(stateData?.ui?.defaultAgentId || 'iris');
    const runtimeStatus = hermesRuntimeData && !hermesRuntimeData.error ? hermesRuntimeData.autoStart?.status : null;
    if (runtimeStatus === 'starting') setLaunchPhase('connecting');
    else scheduleLaunchWelcome();
    if (!firstUseGuideAutoStartedRef.current && !readFirstUseGuideCompleted()) {
      firstUseGuideAutoStartedRef.current = true;
      window.setTimeout(() => void runFirstUseGuide({ manual: false }), 950);
    }
  }

  function scheduleLaunchWelcome() {
    const elapsed = Date.now() - launchStartedAtRef.current;
    const delay = Math.max(0, 700 - elapsed);
    for (const timer of launchTimersRef.current) window.clearTimeout(timer);
    launchTimersRef.current = [];
    const welcomeTimer = window.setTimeout(() => {
      setLaunchPhase((current) => current === 'done' ? current : 'welcome');
      const doneTimer = window.setTimeout(() => setLaunchPhase('done'), 1450);
      launchTimersRef.current.push(doneTimer);
    }, delay);
    launchTimersRef.current.push(welcomeTimer);
  }

  async function refreshHermesRuntime() {
    const [data, diagnostics] = await Promise.all([
      fetch('/api/hermes-runtime/status').then((res) => res.json()).catch(() => null),
      fetch('/api/hermes-runtime/diagnostics').then((res) => res.json()).catch(() => null),
    ]);
    if (!data) {
      setHermesApiAvailability('offline');
      setHermesError('Frakio Work 本地管理服务未运行，无法检测 Hermes Runtime。');
      return null;
    }
    setHermesApiAvailability('online');
    if (!data.error) setHermesRuntime(data);
    if (diagnostics && !diagnostics.error) setHermesDiagnostics(diagnostics);
    return data;
  }

  async function startHermesRuntime() {
    setHermesError('');
    const data = await fetch('/api/hermes-runtime/start', { method: 'POST' }).then((res) => res.json()).catch((error) => ({ error: String(error?.message || error) }));
    if (data?.runtime) setHermesRuntime(data.runtime);
    else if (data?.bridge) setHermesRuntime(await refreshHermesRuntime());
    if (data?.error) setHermesError(data.error);
    await refreshHermesStatus();
  }

  async function startHermesProfileGateway(profileName: string) {
    setHermesError('');
    const data = await fetch(`/api/hermes-runtime/profiles/${encodeURIComponent(profileName)}/gateway/start`, { method: 'POST' }).then((res) => res.json()).catch((error) => ({ error: String(error?.message || error) }));
    if (data?.runtime) setHermesRuntime(data.runtime);
    if (data?.error) setHermesError(data.error);
  }

  async function refreshUpdatesStatus() {
    const data = await fetch('/api/updates/status').then((res) => res.json()).catch((error) => ({ error: String(error?.message || error) }));
    if (!data?.error) setUpdatesStatus(data);
    else setUpdatesError(data.error);
    return data;
  }

  async function checkHermesRuntimeUpdate() {
    setUpdatesBusy('runtime-check');
    setUpdatesError('');
    setUpdatesResult(null);
    try {
      const res = await fetch('/api/hermes-runtime/check-update', { method: 'POST' });
      const data = await res.json();
      if (data.runtime) setHermesRuntime(data.runtime);
      if (!res.ok) setUpdatesError(data.error || '检查 Hermes Runtime 更新失败。');
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '检查 Hermes Runtime 更新失败。');
    } finally {
      setUpdatesBusy('');
    }
  }

  async function installHermesRuntime() {
    setUpdatesBusy('runtime-install');
    setUpdatesError('');
    setUpdatesResult(null);
    try {
      const res = await fetch('/api/hermes-runtime/install', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.runtime) setHermesRuntime(data.runtime);
      setUpdatesResult({ ok: data.ok, target: 'hermes-agent', phase: data.phase, logs: data.logs, error: data.error, runtime: data.runtime });
      if (!res.ok) setUpdatesError(data.error || '安装 Hermes Runtime 失败。');
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '安装 Hermes Runtime 失败。');
    } finally {
      setUpdatesBusy('');
    }
  }

  async function activateHermesRuntime(version: string) {
    setUpdatesBusy(`runtime-activate:${version}`);
    setUpdatesError('');
    try {
      const res = await fetch('/api/hermes-runtime/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ version }) });
      const data = await res.json();
      if (data.runtime) setHermesRuntime(data.runtime);
      if (!res.ok) setUpdatesError(data.error || '切换 Hermes Runtime 失败。');
      else await refreshHermesStatus();
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '切换 Hermes Runtime 失败。');
    } finally {
      setUpdatesBusy('');
    }
  }

  async function useBundledHermesRuntime() {
    setUpdatesBusy('runtime-bundled');
    setUpdatesError('');
    try {
      const res = await fetch('/api/hermes-runtime/use-bundled', { method: 'POST' });
      const data = await res.json();
      if (data.runtime) setHermesRuntime(data.runtime);
      if (!res.ok) setUpdatesError(data.error || '恢复内置 Runtime 失败。');
      else await refreshHermesStatus();
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '恢复内置 Runtime 失败。');
    } finally {
      setUpdatesBusy('');
    }
  }

  async function deleteHermesRuntime(version: string) {
    if (!window.confirm(`删除 Hermes Agent Runtime ${version}？\n\n内置 Runtime 不受影响。`)) return;
    setUpdatesBusy(`runtime-delete:${version}`);
    setUpdatesError('');
    try {
      const res = await fetch(`/api/hermes-runtime/versions/${encodeURIComponent(version)}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.runtime) setHermesRuntime(data.runtime);
      if (!res.ok) setUpdatesError(data.error || '删除 Hermes Runtime 失败。');
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '删除 Hermes Runtime 失败。');
    } finally {
      setUpdatesBusy('');
    }
  }

  async function runUpdateAction(action: 'check' | 'hermes-agent' | 'frakio-work') {
    setUpdatesBusy(action);
    setUpdatesError('');
    setUpdatesResult(null);
    const endpoint = action === 'check' ? '/api/updates/check' : `/api/updates/${action}`;
    try {
      if (action === 'frakio-work') {
        const release = await fetch('/api/app-update/status?refresh=1').then((response) => response.json());
        const targetUrl = release.asset?.browser_download_url || release.releaseUrl;
        if (!targetUrl) throw new Error(release.error || '没有找到可用的 GitHub Release。');
        if (window.frakioDesktop?.openRelease) await window.frakioDesktop.openRelease(targetUrl);
        else window.open(targetUrl, '_blank', 'noopener,noreferrer');
        setUpdatesResult({ ok: true, target: 'frakio-work', phase: 'release-download', logs: [`已打开 ${release.latestVersion ? `v${release.latestVersion}` : 'GitHub Releases'}`] });
        return;
      }
      const res = await fetch(endpoint, { method: 'POST' });
      const data: UpdateActionResult = await res.json();
      if (data.status) setUpdatesStatus(data.status);
      setUpdatesResult(data);
      if (data.bootstrap) setHermesBootstrap(data.bootstrap);
      if (data.runtime) setHermesRuntime(data.runtime);
      if (!res.ok) {
        setUpdatesError(data.error || '更新操作失败。');
        return;
      }
      if (action === 'hermes-agent') {
        await refreshHermesRuntime();
        await refreshHermesStatus();
      }
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '更新操作失败。');
    } finally {
      setUpdatesBusy('');
      await refreshUpdatesStatus();
    }
  }

  async function createHermesBackup() {
    setUpdatesBusy('backup');
    setUpdatesError('');
    setUpdatesResult(null);
    try {
      const res = await fetch('/api/updates/hermes-agent/backup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: 'manual' }),
      });
      const data: UpdateActionResult = await res.json();
      if (data.status) setUpdatesStatus(data.status);
      setUpdatesResult(data);
      if (!res.ok) setUpdatesError(data.error || '备份失败。');
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '备份失败。');
    } finally {
      setUpdatesBusy('');
      await refreshUpdatesStatus();
    }
  }

  async function rollbackHermesBackup(backup: HermesBackup, scopes: RollbackScopes) {
    const targetVersion = backup.before?.displayVersion || backup.before?.tagDescription || shortCommit(backup.before?.commit || '') || '这个版本';
    if (!window.confirm(`回滚到 ${targetVersion}？\n\n当前状态会先创建新的快照，然后恢复所选配置。`)) return;
    setUpdatesBusy(`rollback:${backup.id}`);
    setUpdatesError('');
    setUpdatesResult(null);
    try {
      const res = await fetch(`/api/updates/hermes-agent/backups/${encodeURIComponent(backup.id)}/rollback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scopes }),
      });
      const data: UpdateActionResult = await res.json();
      if (data.status) setUpdatesStatus(data.status);
      setUpdatesResult(data);
      if (data.bootstrap) setHermesBootstrap(data.bootstrap);
      if (data.runtime) setHermesRuntime(data.runtime);
      if (!res.ok) {
        setUpdatesError(data.error || '回滚失败。');
        return;
      }
      await refreshHermesRuntime();
      await refreshHermesStatus();
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '回滚失败。');
    } finally {
      setUpdatesBusy('');
      await refreshUpdatesStatus();
    }
  }

  async function deleteHermesBackup(backup: HermesBackup) {
    if (!window.confirm(`删除这个备份？\n\n路径：${backup.path}\n大小：${formatFileSize(backup.size || 0)}`)) return;
    setUpdatesBusy(`delete:${backup.id}`);
    setUpdatesError('');
    try {
      const res = await fetch(`/api/updates/hermes-agent/backups/${encodeURIComponent(backup.id)}`, { method: 'DELETE' });
      const data: UpdateActionResult = await res.json();
      if (data.status) setUpdatesStatus(data.status);
      setUpdatesResult(data);
      if (!res.ok) setUpdatesError(data.error || '删除备份失败。');
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '删除备份失败。');
    } finally {
      setUpdatesBusy('');
      await refreshUpdatesStatus();
    }
  }

  async function cleanupHermesBackups(mode: 'older-than-30-days' | 'keep-latest-10') {
    const label = mode === 'older-than-30-days' ? '删除 30 天前备份' : '删除除最近 10 条外的旧备份';
    if (!window.confirm(`${label}？\n\n这个操作只清理备份缓存，不影响当前 Hermes 配置。`)) return;
    setUpdatesBusy(`cleanup:${mode}`);
    setUpdatesError('');
    try {
      const res = await fetch('/api/updates/hermes-agent/backups/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      });
      const data: UpdateActionResult = await res.json();
      if (data.status) setUpdatesStatus(data.status);
      setUpdatesResult(data);
      if (!res.ok) setUpdatesError(data.error || '清理备份失败。');
    } catch (error) {
      setUpdatesError(error instanceof Error ? error.message : '清理备份失败。');
    } finally {
      setUpdatesBusy('');
      await refreshUpdatesStatus();
    }
  }

  function updateFirstUseStep(id: string, status: FirstUseGuideStepStatus, detail?: string) {
    setFirstUseGuide((current) => ({
      ...current,
      steps: current.steps.map((step) => step.id === id ? { ...step, status, detail: detail ?? step.detail } : step),
    }));
  }

  async function runFirstUseGuide({ manual = true } = {}) {
    setShowFirstUseGuide(true);
    setHermesError('');
    setFirstUseGuide({
      status: 'running',
      title: manual ? '正在重新运行初次使用引导' : '正在完成初次使用引导',
      detail: 'Frakio Work 会初始化 Hermes Home、启动内置 Runtime，并同步已有 Profile。',
      error: '',
      steps: createFirstUseGuideSteps(),
    });
    try {
      updateFirstUseStep('detect', 'running', '读取 ~/.hermes 和 Frakio Work Runtime 状态');
      const bootstrapRes = await fetch('/api/hermes-bootstrap/status');
      const bootstrapData = await bootstrapRes.json();
      if (!bootstrapRes.ok) throw new Error(bootstrapData.error || 'Hermes 检测失败。');
      setHermesBootstrap(bootstrapData);
      updateFirstUseStep('detect', 'ready', `${bootstrapData.installPath || '~/.hermes'} · ${bootstrapData.profiles?.length || 0} 个 Profile`);
      if (bootstrapData.status === 'missing' || !bootstrapData.profiles?.length) {
        updateFirstUseStep('runtime', 'skipped', '未发现可连接的 Hermes Home');
        updateFirstUseStep('import', 'skipped', '等待完成 Hermes Agent 配置');
        setFirstUseGuide((current) => ({
          ...current,
          status: 'needs-install',
          title: '未发现可用的 Hermes 配置',
          detail: '可以先准备 Hermes Agent，再回到这里重新运行引导。',
        }));
        return;
      }

      updateFirstUseStep('runtime', 'running', '启动 Frakio Work Bridge、Runtime API 和 Profile Gateway');
      const runtimeRes = await fetch('/api/hermes-runtime/start', { method: 'POST' });
      const runtimeData = await runtimeRes.json();
      if (!runtimeRes.ok) throw new Error(runtimeData.error || 'Hermes Runtime 启动失败。');
      if (runtimeData.runtime) setHermesRuntime(runtimeData.runtime);
      const autoStartStatus = runtimeData.autoStart?.status || runtimeData.runtime?.autoStart?.status || '';
      updateFirstUseStep('runtime', autoStartStatus === 'failed' ? 'failed' : 'ready', autoStartStatus === 'partial' ? '部分 Profile Gateway 需要稍后手动启动' : 'Runtime 已就绪');

      updateFirstUseStep('import', 'running', '导入 Profile、Agent 和本地配置');
      const importRes = await fetch('/api/hermes-bootstrap/import', { method: 'POST' });
      const importData = await importRes.json();
      if (!importRes.ok) throw new Error(importData.error || 'Hermes Profile 导入失败。');
      setAgents(importData.agents || []);
      if (importData.bootstrap) setHermesBootstrap(importData.bootstrap);
      await refreshHermesStatus();
      await refreshHermesRuntime();
      await refreshOrg();
      updateFirstUseStep('import', 'ready', `${importData.importedProfiles?.length || 0} 个 Profile 已同步`);
      updateFirstUseStep('finish', 'ready', '以后可在设置里手动重跑');
      writeFirstUseGuideCompleted();
      void fetch('/api/telemetry/onboarding-completed', { method: 'POST' });
      setFirstUseGuide((current) => ({
        ...current,
        status: 'ready',
        title: '本地 Hermes 已连接',
        detail: 'Profile、Bridge 和 Gateway 状态已经同步到 Frakio Work。',
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : '初次使用引导失败。';
      setHermesError(message);
      setFirstUseGuide((current) => ({
        ...current,
        status: 'failed',
        title: '引导没有完成',
        detail: '保留当前状态，修复后可以重新运行。',
        error: message,
        steps: current.steps.map((step) => step.status === 'running' ? { ...step, status: 'failed' } : step),
      }));
    }
  }

  async function installHermesFromGuide() {
    setFirstUseGuide({
      status: 'running',
      title: '正在准备 Hermes Agent',
      detail: 'Frakio Work 会执行官方安装流程，并在完成后重新检测本机 Hermes。',
      error: '',
      steps: createHermesInstallGuideSteps().map((step, index) => index === 0 ? { ...step, status: 'running', detail: '检查 git、python3 和 uv' } : step),
    });
    try {
      const res = await fetch('/api/hermes-bootstrap/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'official', confirmed: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        const installError = new Error(data.error || 'Hermes Agent 准备失败。') as Error & { phase?: string; logs?: string[] };
        installError.phase = data.phase;
        installError.logs = data.logs;
        throw installError;
      }
      if (data.bootstrap) setHermesBootstrap(data.bootstrap);
      setFirstUseGuide((current) => ({
        ...current,
        steps: current.steps.map((step) => ({ ...step, status: 'ready', detail: installStepSuccessDetail(step.id, data) })),
        detail: installLogSummary(data.logs) || 'Hermes Agent 已安装，正在重新检测。',
      }));
      await runFirstUseGuide({ manual: true });
    } catch (error) {
      const installError = error as Error & { phase?: string; logs?: string[] };
      const message = error instanceof Error ? error.message : 'Hermes Agent 准备失败。';
      const detail = installLogSummary(installError.logs) || '保留当前状态，可以重新运行。';
      setHermesError(message);
      setFirstUseGuide((current) => ({
        ...current,
        status: 'failed',
        title: 'Hermes Agent 准备失败',
        detail,
        error: message,
        steps: markInstallFailure(current.steps, message, installError.phase),
      }));
    }
  }

  async function refreshLeftRail() {
    const [spaceData, workspaceData, conversationData] = await Promise.all([
      fetch('/api/spaces').then((res) => res.json()),
      fetch('/api/workspaces').then((res) => res.json()),
      fetch('/api/conversations').then((res) => res.json()),
    ]);
    setSpaces(spaceData.spaces || []);
    setWorkspaces(workspaceData.workspaces || []);
    setConversations(conversationData.conversations || []);
  }

  async function switchSpace(spaceId: string) {
    if (spaceId === activeSpaceId) return;
    if (!closeProfileInspector()) return;
    const currentIndex = spaces.findIndex((space) => space.id === activeSpaceId);
    const nextIndex = spaces.findIndex((space) => space.id === spaceId);
    setSpaceSwitchDirection(nextIndex > currentIndex ? 'right' : 'left');
    setActiveSpaceId(spaceId);
    setSelectedNewChatWorkspaceId(null);
    setProjectPickerOpen(false);
    if (activeThread?.spaceId !== spaceId) {
      setActiveThread(null);
      setActiveView('new-chat');
      setActiveNav('council');
    }
    await fetch(`/api/spaces/${encodeURIComponent(spaceId)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: true }),
    });
    setUiSettings((current) => ({ ...current, activeSpaceId: spaceId }));
    window.setTimeout(() => setSpaceSwitchDirection('none'), 190);
  }

  function defaultSpaceDraft() {
    return { name: '', iconKind: 'dot' as SpaceIconKind, iconValue: '', theme: buildSpaceThemeFromPoint(0.18, 0.72, '#536006', 'soft' as const) };
  }

  function resetSpaceDraft() {
    setSpaceDraft(defaultSpaceDraft());
    setSpaceColorPoint({ x: 0.18, y: 0.72 });
  }

  function openSpaceCreate() {
    setSpaceEditTargetId(null);
    resetSpaceDraft();
    setSpaceMenuOpen(false);
    setRailContextMenu(null);
    setSpaceCreateOpen(true);
  }

  function closeSpaceEditor() {
    setSpaceCreateOpen(false);
    setSpaceEditTargetId(null);
    setRailContextMenu(null);
  }

  function openSpaceEditor(space: Space) {
    const theme = normalizeSpaceTheme(space.theme);
    const primary = primaryGradientColor(theme);
    const kind = spaceIconKind(space);
    setSpaceDraft({
      name: space.name,
      iconKind: kind,
      iconValue: kind === 'dot' ? '' : space.iconValue,
      theme,
    });
    setSpaceColorPoint({ x: primary.x, y: primary.y });
    setSpaceEditTargetId(space.id);
    setSpaceMenuOpen(false);
    setRailContextMenu(null);
    setSpaceCreateOpen(true);
  }

  async function submitSpaceDraft() {
    const name = spaceDraft.name.trim();
    if (!name) return;
    const isEditing = Boolean(spaceEditTargetId);
    const res = await fetch(isEditing ? `/api/spaces/${encodeURIComponent(spaceEditTargetId!)}` : '/api/spaces', {
      method: isEditing ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...spaceDraft, name }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || (isEditing ? '工作区保存失败。' : '工作区创建失败。'));
      return;
    }
    const savedSpace = data.space as Space | undefined;
    const nextActiveSpaceId = isEditing ? activeSpaceId : (data.activeSpaceId || savedSpace?.id || activeSpaceId);
    if (savedSpace) {
      setSpaces((current) => {
        const exists = current.some((space) => space.id === savedSpace.id);
        return exists ? current.map((space) => (space.id === savedSpace.id ? savedSpace : space)) : [...current, savedSpace];
      });
    }
    if (!isEditing) {
      setActiveSpaceId(nextActiveSpaceId);
      setUiSettings((current) => ({ ...current, activeSpaceId: nextActiveSpaceId }));
      setActiveThread(null);
      setActiveView('new-chat');
      setActiveNav('council');
    }
    setSpaceCreateOpen(false);
    setSpaceEditTargetId(null);
    setSpaceMenuOpen(false);
    resetSpaceDraft();
    await refreshLeftRail();
    if (!isEditing) setActiveSpaceId(nextActiveSpaceId);
  }

  function updateDraftThemeFromPoint(xValue: number, yValue: number, colorId?: string | null) {
    const { x, y } = clampThemePointToSquare(xValue, yValue);
    const nextColor = colorFromThemePoint(x, y);
    setSpaceColorPoint({ x, y });
    setSelectedThemePresetId(null);
    setSpaceDraft((current) => {
      const activeId = colorId || primaryGradientColor(current.theme).id;
      const colors = normalizeGradientColors(current.theme);
      const active = colors.find((color) => color.id === activeId) || primaryGradientColor(current.theme);
      const promoted = colors.map((color) => ({ ...color, isPrimary: color.id === active.id }));
      const moved = promoted.map((color) => color.id === active.id ? { ...color, x, y, color: nextColor, isPrimary: true } : color);
      const gradientColors = calculateHarmonyColors(moved, 'update', themeHarmony);
      const nextPalette = syncThemeFromGradientColors({ ...current.theme, gradientColors });
      return { ...current, theme: withDraftThemePalette(current.theme, nextPalette) };
    });
  }

  function applyThemePreset(preset: ThemePreset) {
    setSpaceColorPoint(preset.point);
    setSelectedThemePresetId(preset.id);
    setThemeHarmony(preset.harmony);
    const gradientColors = buildPresetGradientColors(preset.colors, preset.point, preset.harmony, preset.type);
    setSpaceDraft((current) => {
      const nextPalette = syncThemeFromGradientColors({
        ...current.theme,
        accentColor: preset.colors[0],
        sidebarBg: mixHexWithWhite(preset.colors[0], current.theme.mode === 'crisp' ? 0.66 : 0.78),
        gradientColors,
      });
      return { ...current, theme: withDraftThemePalette(current.theme, nextPalette) };
    });
  }

  function applyDefaultThemePreset() {
    const theme = normalizeSpaceThemePalette(defaultProductSpaceTheme);
    const primary = primaryGradientColor(theme);
    setSpaceColorPoint({ x: primary.x, y: primary.y });
    setSelectedThemePresetId('frakio-default');
    setThemeHarmony('floating');
    setSpaceDraft((current) => ({ ...current, theme: withDraftThemePalette(current.theme, theme) }));
  }

  function changeThemePresetPage(direction: -1 | 1) {
    setThemePresetPage((current) => clampNumber(current + direction, 0, themePresetPages.length - 1));
  }

  function setDraftThemeMode(mode: SpaceTheme['mode']) {
    setSpaceDraft((current) => {
      const nextPalette = syncThemeFromGradientColors({
        ...current.theme,
        mode,
        sidebarBg: mixHexWithWhite(primaryGradientColor(current.theme).color, mode === 'crisp' ? 0.66 : 0.78),
      });
      return { ...current, theme: withDraftThemePalette(current.theme, nextPalette) };
    });
  }

  function setDraftThemeAppearance(appearance: SpaceThemeAppearance) {
    setSpaceDraft((current) => {
      const normalized = normalizeSpaceTheme({ ...current.theme, appearance });
      const palette = appearance === 'dark' || (appearance === 'auto' && isThemeNightTime())
        ? normalized.darkTheme!
        : normalized.lightTheme!;
      const primary = primaryGradientColor(palette);
      setSpaceColorPoint({ x: primary.x, y: primary.y });
      return { ...current, theme: { ...palette, appearance, lightTheme: normalized.lightTheme, darkTheme: normalized.darkTheme } };
    });
  }

  function addDraftThemeColor() {
    setSpaceDraft((current) => {
      const colors = normalizeGradientColors(current.theme);
      if (colors.length >= 3) return current;
      const nextHarmony: ThemeHarmony = colors.length === 1 ? 'complementary' : 'splitComplementary';
      setThemeHarmony(nextHarmony);
      setSelectedThemePresetId(null);
      const nextColors = calculateHarmonyColors(colors, 'add', nextHarmony);
      const nextPalette = syncThemeFromGradientColors({ ...current.theme, gradientColors: nextColors });
      return { ...current, theme: withDraftThemePalette(current.theme, nextPalette) };
    });
  }

  function removeDraftThemeColor() {
    setSpaceDraft((current) => {
      const colors = normalizeGradientColors(current.theme);
      if (colors.length <= 1) return current;
      const removable = [...colors].reverse().find((color) => !color.isPrimary);
      const remaining = colors.filter((color) => color.id !== removable?.id);
      const nextHarmony: ThemeHarmony = remaining.length === 2 ? 'singleAnalogous' : 'floating';
      setThemeHarmony(nextHarmony);
      setSelectedThemePresetId(null);
      const nextColors = calculateHarmonyColors(remaining, 'remove', nextHarmony);
      const nextPalette = syncThemeFromGradientColors({ ...current.theme, gradientColors: nextColors });
      return { ...current, theme: withDraftThemePalette(current.theme, nextPalette) };
    });
  }

  function promoteDraftThemeColor(colorId: string) {
    if (themeDragMovedRef.current) return;
    setSelectedThemePresetId(null);
    setSpaceDraft((current) => {
      const colors = normalizeGradientColors(current.theme).map((color) => ({ ...color, isPrimary: color.id === colorId }));
      const nextTheme = syncThemeFromGradientColors({ ...current.theme, gradientColors: calculateHarmonyColors(colors, 'update', themeHarmony) });
      const primary = primaryGradientColor(nextTheme);
      setSpaceColorPoint({ x: primary.x, y: primary.y });
      return { ...current, theme: withDraftThemePalette(current.theme, nextTheme) };
    });
  }

  function randomizeDraftThemeColors() {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * 0.44;
    const x = 0.5 + Math.cos(angle) * radius;
    const y = 0.5 + Math.sin(angle) * radius;
    const count = Math.floor(Math.random() * 3) + 1;
    const harmony: ThemeHarmony = count === 1 ? 'floating' : count === 2 ? 'complementary' : 'splitComplementary';
    const primaryColor = colorFromThemePoint(x, y);
    const seedColors = [
      { id: 'primary', color: primaryColor, x, y, isPrimary: true },
      { id: 'secondary_a', color: primaryColor, x, y },
      { id: 'secondary_b', color: primaryColor, x, y },
    ].slice(0, count);
    const gradientColors = count === 1 ? seedColors : calculateHarmonyColors(seedColors, 'update', harmony);
    setSpaceColorPoint({ x, y });
    setThemeHarmony(harmony);
    setSelectedThemePresetId(null);
    setSpaceDraft((current) => {
      const nextPalette = syncThemeFromGradientColors({ ...current.theme, gradientColors });
      return { ...current, theme: withDraftThemePalette(current.theme, nextPalette) };
    });
  }

  function renderDraftIcon(size = 18) {
    if (spaceDraft.iconKind === 'emoji') return <span>{spaceDraft.iconValue || '✨'}</span>;
    if (spaceDraft.iconKind === 'icon') {
      if (spaceDraft.iconValue === 'briefcase') return <Briefcase size={size} />;
      if (spaceDraft.iconValue === 'sparkles') return <Sparkles size={size} />;
      if (spaceDraft.iconValue === 'library') return <Library size={size} />;
      return <Folder size={size} />;
    }
    return <span className="field-dot" />;
  }

  function handleThemePanelPointer(event: React.PointerEvent<HTMLElement>, colorId?: string | null) {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.theme-picker-toolbar, .theme-picker-controls, button, input, [role="slider"]')) {
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    updateDraftThemeFromPoint(x, y, colorId || themeDragColorRef.current);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleThemeDotPointer(event: React.PointerEvent<HTMLButtonElement>, colorId: string) {
    event.preventDefault();
    event.stopPropagation();
    themeDragColorRef.current = colorId;
    themeDragMovedRef.current = false;
    themeDragStartRef.current = { x: event.clientX, y: event.clientY };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleThemeDotMove(event: React.PointerEvent<HTMLButtonElement>, colorId: string) {
    if (!themeDragColorRef.current || event.buttons !== 1) return;
    const start = themeDragStartRef.current;
    if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) < 3) return;
    themeDragMovedRef.current = true;
    const panel = event.currentTarget.closest('.theme-dot-matrix') as HTMLElement | null;
    if (!panel) return;
    const rect = panel.getBoundingClientRect();
    updateDraftThemeFromPoint((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height, colorId);
  }

  function finishThemeDotPointer() {
    themeDragColorRef.current = null;
    themeDragStartRef.current = null;
    window.setTimeout(() => { themeDragMovedRef.current = false; }, 0);
  }

  function setDraftTextureFromPointer(event: React.PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const rotation = Math.atan2(event.clientY - rect.top - rect.height / 2, event.clientX - rect.left - rect.width / 2);
    let texture = (rotation * 180 / Math.PI + 90) / 360;
    if (texture < 0) texture += 1;
    texture = Math.round(texture * 16) / 16;
    if (texture === 1) texture = 0;
    setSpaceDraft((current) => ({ ...current, theme: { ...current.theme, texture, noise: texture * 0.35 } }));
  }

  function handleTexturePointerDown(event: React.PointerEvent<HTMLElement>) {
    event.preventDefault();
    textureDragRef.current = true;
    setDraftTextureFromPointer(event);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleTexturePointerMove(event: React.PointerEvent<HTMLElement>) {
    if (!textureDragRef.current || event.buttons !== 1) return;
    setDraftTextureFromPointer(event);
  }

  function finishTexturePointer() {
    textureDragRef.current = false;
  }

  async function refreshArchivedThreads() {
    const data = await fetch('/api/threads/archived').then((res) => res.json()).catch(() => ({ threads: [] }));
    setArchivedThreads(data.threads || []);
  }

  async function loadThreads(targetWorkspaceId = workspaceId, preferredThreadId?: string | null) {
    const data = await fetch(`/api/workspaces/${targetWorkspaceId}/threads`).then((res) => res.json());
    setThreads(data.threads);
    const targetId = preferredThreadId || data.threads[0]?.id;
    if (targetId) await openThread(targetId);
  }

  async function openThread(threadId: string) {
    const data = await fetch(`/api/threads/${threadId}`).then((res) => res.json());
    setInput('');
    setThreadFollowState(true);
    setActiveThread(data.thread);
    setActiveView('thread');
    scheduleThreadScrollToLatest();
  }

  async function loadVaultSummary(vaultId: string) {
    const data = await fetch(`/api/vaults/${vaultId}/summary`).then((res) => res.json());
    setVaultSummary(data);
  }

  async function loadWorkspaceArtifacts(targetWorkspaceId: string) {
    const data = await fetch(`/api/workspaces/${targetWorkspaceId}/artifacts`).then((res) => res.json()).catch(() => ({ artifacts: [] }));
    setWorkspaceArtifacts(data.artifacts || []);
  }

  async function persistUi(next: Partial<{ libraryCollapsed: boolean; pinnedNav: PinnedNav; sidebarCollapsed: boolean } & WorkbenchUiSettings>) {
    if ('libraryCollapsed' in next) setLibraryCollapsed(Boolean(next.libraryCollapsed));
    if ('sidebarCollapsed' in next) {
      const collapsed = Boolean(next.sidebarCollapsed);
      setSidebarCollapsed(collapsed);
      setSidebarManuallyExpanded(!collapsed);
    }
    if (typeof next.sidebarWidth === 'number') setSidebarWidth(clampNumber(next.sidebarWidth, sidebarWidthBounds.min, sidebarWidthBounds.max));
    if (typeof next.contextWidth === 'number') setContextWidth(clampNumber(next.contextWidth, contextWidthBounds.min, contextWidthBounds.max));
    if ('pinnedNav' in next && next.pinnedNav) setPinnedNav(next.pinnedNav);
    setUiSettings((current) => ({ ...current, ...(next as WorkbenchUiSettings) }));
    await fetch('/api/state/ui', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(next),
    });
    if ('telemetryEnabled' in next || 'telemetryNoticeSeenAt' in next) {
      const status = await fetch('/api/telemetry/status').then((res) => res.json()).catch(() => null);
      if (status) setTelemetryStatus(status);
    }
  }

  async function answerTelemetryConsent(enabled: boolean) {
    const seenAt = new Date().toISOString();
    setShowTelemetryNotice(false);
    await persistUi({ telemetryEnabled: enabled, telemetryNoticeSeenAt: seenAt });
  }

  function toggleDesktopSidebar() {
    const nextCollapsed = !effectiveSidebarCollapsed;
    setSidebarManuallyExpanded(!nextCollapsed);
    void persistUi({ sidebarCollapsed: nextCollapsed });
  }

  function toggleWorkspaceCollapsed(workspaceId: string) {
    const currentIds = uiSettings.collapsedWorkspaceIds || [];
    const nextIds = currentIds.includes(workspaceId)
      ? currentIds.filter((id) => id !== workspaceId)
      : [...currentIds, workspaceId];
    void persistUi({ collapsedWorkspaceIds: nextIds });
  }

  async function revealThreadMessages(nextThread: Thread, previousMessageIds: Set<string>) {
    const targets = nextThread.messages.filter((message) => (
      message.agentId !== 'user'
      && !previousMessageIds.has(message.id)
      && isVisibleChatMessage(message)
      && message.content.trim()
    ));
    const targetIds = targets.map((message) => message.id);
    if (uiSettings.streamingResponses === false || targets.length === 0) {
      setActiveThread(nextThread);
      return targetIds;
    }
    setAnimatedMessageContent((current) => ({
      ...current,
      ...Object.fromEntries(targetIds.map((messageId) => [messageId, ''])),
    }));
    setStreamingMessageIds((current) => ({
      ...current,
      ...Object.fromEntries(targetIds.map((messageId) => [messageId, true])),
    }));
    setActiveThread(nextThread);
    for (const message of targets) {
      const content = message.content;
      const chunkSize = content.length > 1200 ? 12 : content.length > 520 ? 7 : 4;
      for (let index = 0; index < content.length; index += chunkSize) {
        await new Promise((resolve) => window.setTimeout(resolve, 18));
        const nextContent = content.slice(0, Math.min(content.length, index + chunkSize));
        setAnimatedMessageContent((current) => ({ ...current, [message.id]: nextContent }));
      }
      setStreamingMessageIds((current) => {
        const next = { ...current };
        delete next[message.id];
        return next;
      });
      setAnimatedMessageContent((current) => ({ ...current, [message.id]: content }));
    }
    return targetIds;
  }

  function closeProfileInspector(force = false) {
    if (!force && profileInspectorDirty && !window.confirm('当前编辑内容还没有保存，确定关闭吗？')) return false;
    profileInspectorRequestRef.current += 1;
    setProfileInspector({ target: null, draft: '', original: '', loading: false, saving: false, error: '', errorStage: '', saved: false });
    return true;
  }

  async function openProfileInspector(target: ProfileInspectorTarget) {
    if (profileInspectorDirty && !window.confirm('当前编辑内容还没有保存，确定切换编辑对象吗？')) return;
    const requestId = profileInspectorRequestRef.current + 1;
    profileInspectorRequestRef.current = requestId;
    setProfileInspector({ target, draft: '', original: '', loading: true, saving: false, error: '', errorStage: '', saved: false });
    const query = new URLSearchParams({ kind: target.kind });
    if (target.moduleName) query.set('name', target.moduleName);
    try {
      const res = await fetch(`/api/hermes-profiles/${encodeURIComponent(target.profileName)}/file?${query.toString()}`);
      const payload = await res.json();
      if (!res.ok) throw new Error(payload.error || '读取失败。');
      if (profileInspectorRequestRef.current !== requestId) return;
      setProfileInspector({ target, draft: payload.content || '', original: payload.content || '', loading: false, saving: false, error: '', errorStage: '', saved: false });
    } catch (error) {
      if (profileInspectorRequestRef.current !== requestId) return;
      setProfileInspector({ target, draft: '', original: '', loading: false, saving: false, error: error instanceof Error ? error.message : '读取失败。', errorStage: 'load', saved: false });
    }
  }

  async function saveProfileInspector() {
    const target = profileInspector.target;
    if (!target || profileInspector.saving || profileInspector.loading) return;
    setProfileInspector((current) => ({ ...current, saving: true, error: '', errorStage: '', saved: false }));
    try {
      const res = await fetch(`/api/hermes-profiles/${encodeURIComponent(target.profileName)}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: target.kind, name: target.moduleName, content: profileInspector.draft }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '保存失败。');
      await refreshOrg().catch(() => undefined);
      closeProfileInspector(true);
    } catch (error) {
      setProfileInspector((current) => ({ ...current, saving: false, error: error instanceof Error ? error.message : '保存失败。', errorStage: 'save', saved: false }));
    }
  }

  function changeSettingsSection(section: SettingsSection) {
    if (section === settingsSection) return;
    if (!closeProfileInspector()) return;
    setSettingsSection(section);
  }

  function selectOrgAgent(agentId: string) {
    if (agentId === selectedOrgAgentId) return;
    if (!closeProfileInspector()) return;
    setSelectedOrgAgentId(agentId);
  }

  async function createThread() {
    const fallbackWorkspace = activeWorkspace || visibleWorkspaces[0];
    const targetWorkspaceId = activeThread?.mode === 'workspace' && activeThread.workspaceId ? activeThread.workspaceId : fallbackWorkspace?.id || workspaceId;
    const data = await fetch(`/api/workspaces/${targetWorkspaceId}/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: '新的项目对话' }),
    }).then((res) => res.json());
    await refreshLeftRail();
    await loadThreads(targetWorkspaceId, data.thread.id);
  }

  function openProjectModal(mode: 'create' | 'existing' = 'create', purpose: 'create' | 'convert' = 'create') {
    setProjectModalPurpose(purpose);
    setProjectMode(mode);
    setProjectName(purpose === 'convert' && activeThread?.mode === 'direct' ? activeThread.title : '');
    setProjectRootPath('');
    setProjectParentPath(defaultProjectParentPath);
    setProjectError('');
    setProjectModalOpen(true);
  }

  async function selectProjectFolder() {
    const picker = window.frakioDesktop?.selectFolder;
    if (!picker) return null;
    const result = await picker();
    const selectedPath = String(result?.path || result?.filePaths?.[0] || '').trim();
    if (result?.canceled || !selectedPath) return null;
    return selectedPath;
  }

  function projectNameFromPath(targetPath: string) {
    return targetPath.split(/[\\/]+/).filter(Boolean).at(-1) || '新的项目';
  }

  async function submitWorkspaceProject(payload: Record<string, unknown>) {
    setProjectError('');
    const res = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setProjectError(data.error || '项目创建失败。');
      return;
    }
    setProjectModalOpen(false);
    await refreshLeftRail();
    await loadThreads(data.workspace.id, data.thread.id);
  }

  async function submitConvertToProject(payload: Record<string, unknown>) {
    if (!activeThread || activeThread.mode !== 'direct') return;
    setProjectError('');
    const res = await fetch(`/api/threads/${activeThread.id}/convert-to-workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setProjectError(data.error || '项目转换失败。');
      return;
    }
    setProjectModalOpen(false);
    await refreshLeftRail();
    await loadThreads(data.workspace.id, data.thread.id);
  }

  async function createWorkspaceProject() {
    const payload = projectMode === 'existing'
      ? { mode: projectMode, rootPath: projectRootPath.trim(), spaceId: activeSpaceId }
      : { mode: projectMode, name: projectName.trim(), parentPath: projectParentPath.trim() || undefined, spaceId: activeSpaceId };
    await submitWorkspaceProject(payload);
  }

  async function chooseExistingProjectFolder() {
    setProjectError('');
    setProjectMode('existing');
    const folderPath = await selectProjectFolder();
    if (!folderPath) {
      if (!window.frakioDesktop?.selectFolder) setProjectMode('existing');
      return;
    }
    setProjectRootPath(folderPath);
    const payload = { mode: 'existing', name: projectNameFromPath(folderPath), rootPath: folderPath, spaceId: activeSpaceId };
    if (projectModalPurpose === 'convert') await submitConvertToProject(payload);
    else await submitWorkspaceProject({ mode: 'existing', rootPath: folderPath, spaceId: activeSpaceId });
  }

  async function chooseProjectParentFolder() {
    setProjectError('');
    const folderPath = await selectProjectFolder();
    if (!folderPath) return;
    setProjectParentPath(folderPath);
  }

  async function createConversation(primaryAgentId: string | null = null) {
    const primary = agents.find((agent) => agent.id === primaryAgentId);
    const data = await fetch('/api/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primaryAgentId, title: primary ? `${primary.name} 对话` : '新的对话', agentModelOverrides: {}, spaceId: activeSpaceId }),
    }).then((res) => res.json());
    await refreshLeftRail();
    await openThread(data.thread.id);
  }

  async function deleteThread(threadId: string) {
    const res = await fetch(`/api/threads/${threadId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || '对话删除失败。');
      return;
    }
    setRailConfirm(null);
    await refreshLeftRail();
    if (activeThread?.id === threadId) {
      if (data.nextThreadId) await openThread(data.nextThreadId);
      else {
        setActiveThread(null);
        setActiveView('new-chat');
      }
    }
  }

  async function patchThread(threadId: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/threads/${threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || '对话操作失败。');
      return null;
    }
    await refreshLeftRail();
    if (settingsSection === 'archivedThreads') await refreshArchivedThreads();
    if (activeThread?.id === threadId) {
      if (payload.archived === true) {
        setActiveThread(null);
        setActiveView('new-chat');
      } else {
        setActiveThread(data.thread);
      }
    }
    return data.thread as Thread;
  }

  async function archiveThread(threadId: string) {
    setRailConfirm(null);
    await patchThread(threadId, { archived: true });
  }

  async function restoreThread(threadId: string) {
    await patchThread(threadId, { archived: false });
  }

  async function toggleThreadPinned(thread: ThreadSummary) {
    await patchThread(thread.id, { pinned: !thread.pinnedAt });
  }

  async function renameThread(thread: ThreadSummary) {
    const title = window.prompt('重命名对话', thread.title)?.trim();
    if (!title || title === thread.title) return;
    await patchThread(thread.id, { title });
  }

  async function patchWorkspace(workspaceId: string, payload: Record<string, unknown>) {
    const res = await fetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || '项目操作失败。');
      return null;
    }
    await refreshLeftRail();
    if (activeThread?.workspaceId === workspaceId && payload.archived === true) {
      setActiveThread(null);
      setActiveView('new-chat');
    }
    return data.workspace as Workspace;
  }

  async function toggleWorkspacePinned(workspace: Workspace) {
    await patchWorkspace(workspace.id, { pinned: !workspace.pinnedAt });
  }

  async function renameWorkspace(workspace: Workspace) {
    const name = window.prompt('重命名项目', workspace.name)?.trim();
    if (!name || name === workspace.name) return;
    await patchWorkspace(workspace.id, { name });
  }

  async function copyText(value: string) {
    if (!value) return;
    await navigator.clipboard?.writeText(value);
  }

  async function showInFinder(targetPath: string) {
    if (!targetPath || !window.frakioDesktop?.showItemInFolder) return;
    await window.frakioDesktop.showItemInFolder(targetPath);
  }

  function openRailContextMenu(event: React.MouseEvent, target: RailContextMenuSource) {
    event.preventDefault();
    event.stopPropagation();
    setRailConfirm(null);
    const toMenuRect = (rect: DOMRect): RailContextMenuRect => ({
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    });
    const anchor = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    const sidebar = anchor?.closest('.sidebar') as HTMLElement | null;
    setRailContextMenu({
      ...target,
      x: event.clientX,
      y: event.clientY,
      anchorRect: anchor ? toMenuRect(anchor.getBoundingClientRect()) : undefined,
      sidebarRect: sidebar ? toMenuRect(sidebar.getBoundingClientRect()) : undefined,
    } as RailContextMenuTarget);
  }

  function openRailDeleteConfirmFromMenu(target: Omit<Exclude<RailConfirm, null>, 'action' | 'x' | 'y'>) {
    const anchorRect = railContextMenu?.anchorRect;
    setRailContextMenu(null);
    setRailConfirm({
      ...target,
      action: 'delete',
      x: (anchorRect?.right ?? railContextMenu?.x ?? 8) + 8,
      y: (anchorRect?.top ?? railContextMenu?.y ?? 8) - 8,
    });
  }

  async function archiveWorkspace(workspaceId: string) {
    const res = await fetch(`/api/workspaces/${workspaceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ archived: true }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || '项目归档失败。');
      return;
    }
    setRailConfirm(null);
    await refreshLeftRail();
    if (activeThread?.workspaceId === workspaceId) {
      setActiveThread(null);
      setActiveView('new-chat');
    }
  }

  async function deleteWorkspace(workspaceId: string) {
    const res = await fetch(`/api/workspaces/${workspaceId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || '项目删除失败。');
      return;
    }
    setRailConfirm(null);
    await refreshLeftRail();
    if (activeThread?.workspaceId === workspaceId) {
      setActiveThread(null);
      setActiveView('new-chat');
    }
  }

  function confirmRailAction(target: RailConfirm) {
    if (!target) return;
    if (target.kind === 'thread') void deleteThread(target.id);
    else void deleteWorkspace(target.id);
  }

  async function syncHermesApprovalMode(permissionMode: PermissionMode, profileName?: string) {
    const approvalRes = await fetch('/api/hermes-bootstrap/approvals', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: permissionMode, profileName: profileName || hermesBootstrap?.approval.profileName || 'default' }),
    });
    const approvalData = await approvalRes.json().catch(() => ({}));
    if (!approvalRes.ok) throw new Error(approvalData.error || '操作权限同步失败。');
    setHermesBootstrap((current) => current ? { ...current, approval: { ...current.approval, profileName: approvalData.approval?.profileName || current.approval.profileName, mode: permissionMode } } : current);
    return approvalData;
  }

  async function patchThreadPermission(threadId: string, permissionMode: PermissionMode, profileName?: string) {
    await fetch(`/api/threads/${threadId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionMode }),
    });
    await syncHermesApprovalMode(permissionMode, profileName);
  }

  async function updateThreadFollowMode(followMode: FollowMode) {
    if (!activeThread) return;
    const data = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ followMode }),
    }).then((res) => res.json());
    setActiveThread(data.thread);
    await refreshLeftRail();
  }

  async function convertActiveConversationToProject() {
    if (!activeThread || activeThread.mode !== 'direct') return;
    const fallbackName = activeThread.title && activeThread.title !== '新的对话' ? activeThread.title : '新的项目';
    const payload = projectMode === 'existing'
      ? { mode: projectMode, name: projectName.trim() || projectNameFromPath(projectRootPath.trim()) || fallbackName, rootPath: projectRootPath.trim(), spaceId: activeSpaceId }
      : { mode: projectMode, name: projectName.trim() || fallbackName, parentPath: projectParentPath.trim() || undefined, spaceId: activeSpaceId };
    await submitConvertToProject(payload);
  }

  function resetRunUi() {
    setRunDraft('');
    setRunTools([]);
    setRunApproval(null);
    setApprovalSubmitting(false);
    setApprovalError('');
    setRunClarification(null);
    setClarificationSubmitting(false);
    setClarificationError('');
    setRunError('');
    setRunStopping(false);
    setActiveHermesRun(null);
  }

  async function runHermesAgentThread(threadId: string, text: string, selectedAgentsForRun: string[], startedAt: number, target: ChatRunTarget | null) {
    resetRunUi();
    const userDraftMessage: ChatEvent = { id: `local-user-${startedAt}`, agentId: 'user', agentName: '你', role: 'Workspace Owner', content: text };
    const appendMissingRunMessages = (thread: Thread, runId: string, assistantDraft = '') => {
      let nextMessages = [...thread.messages];
      const hasUserMessage = nextMessages.some((message) => message.agentId === 'user' && message.content.trim() === text.trim());
      if (!hasUserMessage) nextMessages = [...nextMessages, userDraftMessage];
      const finalDraft = assistantDraft.trim();
      const hasAssistantResult = nextMessages.some((message) => (
        message.agentId !== 'user'
        && message.agentId !== 'system'
        && (message.externalRunId === runId || (finalDraft && message.content.trim() === finalDraft))
        && message.content.trim()
      ));
      if (!hasAssistantResult && finalDraft) {
        const fallbackAgent = target?.agent || agents.find((agent) => selectedAgentsForRun.includes(agent.id)) || agents.find((agent) => agent.id === thread.defaultAgentId) || agents[0];
        nextMessages = [
          ...nextMessages,
          {
            id: `local-${runId || Date.now()}`,
            agentId: fallbackAgent?.id || 'iris',
            agentName: fallbackAgent?.name || 'Iris',
            role: `${fallbackAgent?.role || 'Agent'} / Hermes Agent`,
            content: assistantDraft,
            externalRunId: runId,
          },
        ];
      }
      return nextMessages === thread.messages ? thread : { ...thread, messages: nextMessages };
    };
    const createRes = await fetch(`/api/threads/${threadId}/runs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, selectedAgents: selectedAgentsForRun, targetAgentId: target?.kind === 'agent' ? target.agent.id : '' }),
    });
    const created = await createRes.json().catch(() => ({}));
    if (!createRes.ok) {
      throw new Error(formatHermesRuntimeError(created.error || 'Hermes Bridge run 创建失败。', target?.agent ? resolveHermesProfileNameForAgent(target.agent, localProfilesForComposer) : activeComposerProfileName, created.details));
    }
    const run = { runId: created.runId, sessionId: created.sessionId, threadId };
    setActiveHermesRun(run);
    await new Promise<void>((resolve, reject) => {
      const params = new URLSearchParams({ sessionId: run.sessionId });
      const events = new EventSource(`/api/threads/${threadId}/runs/${run.runId}/events?${params.toString()}`);
      let settled = false;
      let streamedDraft = '';
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        events.close();
        setRunApproval(null);
        setApprovalSubmitting(false);
        setApprovalError('');
        setRunClarification(null);
        setClarificationSubmitting(false);
        setClarificationError('');
        setRunStopping(false);
        if (error) reject(error);
        else resolve();
      };
      events.onerror = () => {
        const error = new Error('Hermes Agent 事件流中断，run 可能仍在后台继续。');
        finish(error);
      };
      events.onmessage = (event) => {
        const data = JSON.parse(event.data || '{}');
        if (data.event === 'message.delta') {
          const delta = String(data.delta || '');
          streamedDraft += delta;
          setRunDraft((current) => current + delta);
          return;
        }
        if (data.event === 'tool.running') {
          const idValue = data.callId || `${data.toolName || data.tool || 'tool'}:${data.title || data.label || data.argsPreview || ''}`;
          setRunTools((current) => [
            ...current.filter((item) => item.id !== idValue),
            {
              id: idValue,
              tool: data.tool || data.toolName || 'tool',
              label: data.title || data.label || data.toolName || data.tool || '正在调用工具',
              status: 'running',
              toolName: data.toolName || data.tool || '',
              skillName: data.skillName || '',
              title: data.title || data.label || '',
              detail: data.detail || '',
              paths: Array.isArray(data.paths) ? data.paths : [],
              fileCount: data.fileCount,
              argsPreview: data.argsPreview || '',
              resultPreview: data.resultPreview || '',
              updatedAt: data.updatedAt || new Date().toISOString(),
            },
          ]);
          return;
        }
        if (data.event === 'tool.completed') {
          setRunTools((current) => {
            const idValue = data.callId || `${data.toolName || data.tool || 'tool'}:${data.title || data.label || data.argsPreview || ''}`;
            const next = {
              id: idValue,
              tool: data.tool || data.toolName || 'tool',
              label: data.title || data.label || data.toolName || data.tool || '工具调用完成',
              status: data.error ? 'failed' as const : 'completed' as const,
              duration: data.duration,
              toolName: data.toolName || data.tool || '',
              skillName: data.skillName || '',
              title: data.title || data.label || '',
              detail: data.detail || '',
              paths: Array.isArray(data.paths) ? data.paths : [],
              fileCount: data.fileCount,
              argsPreview: data.argsPreview || '',
              resultPreview: data.resultPreview || '',
              updatedAt: data.updatedAt || new Date().toISOString(),
            };
            const index = current.findIndex((item) => item.id === idValue || (item.tool === next.tool && item.status === 'running'));
            if (index < 0) return [...current, next];
            return current.map((item, itemIndex) => itemIndex === index ? { ...item, ...next } : item);
          });
          return;
        }
        if (data.event === 'approval.request') {
          setRunClarification(null);
          setClarificationError('');
          setClarificationSubmitting(false);
          setRunApproval({ id: data.approvalId || data.approval_id || '', title: data.title || '需要确认', command: data.command || '', cwd: data.cwd || '', tool: data.tool || '' });
          setApprovalError('');
          setApprovalSubmitting(false);
          return;
        }
        if (data.event === 'clarify.request') {
          setRunApproval(null);
          setApprovalError('');
          setApprovalSubmitting(false);
          setRunClarification({
            id: data.clarifyId || data.clarify_id || '',
            question: data.question || '需要你补充一个选择',
            choices: Array.isArray(data.choices) ? data.choices.map((choice: unknown) => String(choice)).filter(Boolean) : [],
            timeoutMs: Number(data.timeoutMs || data.timeout_ms || 0) || undefined,
          });
          setClarificationError('');
          setClarificationSubmitting(false);
          return;
        }
        if (data.event === 'clarify.responded') {
          setRunClarification(null);
          setClarificationError('');
          setClarificationSubmitting(false);
          return;
        }
        if (data.event === 'approval.responded') {
          setRunApproval(null);
          setApprovalError('');
          setApprovalSubmitting(false);
          return;
        }
        if (data.event === 'run.completed') {
          setRunTools((current) => current.map((item) => item.status === 'running' ? { ...item, status: 'completed' } : item));
          if (data.thread) {
            const threadFromServer = data.thread as Thread;
            const hasAssistantResult = threadFromServer.messages.some((message) => (
              message.agentId !== 'user'
              && message.agentId !== 'system'
              && (message.externalRunId === run.runId || message.content.trim() === String(data.output || '').trim())
              && message.content.trim()
            ));
            const nextThread = appendMissingRunMessages(threadFromServer, run.runId, hasAssistantResult ? '' : streamedDraft);
            setActiveThread(nextThread);
            const lastMessage = nextThread.messages.filter(isVisibleChatMessage).at(-1);
            setCompletedRunSummary({
              threadId: nextThread.id,
              beforeMessageId: lastMessage?.agentId === 'user' ? null : lastMessage?.id || null,
              elapsedSeconds: Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
            });
            if (hasAssistantResult || streamedDraft.trim()) setRunDraft('');
          }
          finish();
          return;
        }
        if (data.event === 'run.failed' || data.event === 'run.cancelled') {
          const formatted = formatHermesRuntimeError(data.error || (data.event === 'run.cancelled' ? '已停止。' : '运行失败。'), activeComposerProfileName, data.details);
          setRunTools((current) => current.map((item) => item.status === 'running' ? { ...item, status: data.event === 'run.failed' ? 'failed' : 'completed' } : item));
          setRunError(data.event === 'run.failed' ? formatted : '');
          if (data.thread) {
            setActiveThread(appendMissingRunMessages(data.thread as Thread, run.runId, streamedDraft));
            if (streamedDraft.trim()) setRunDraft('');
          }
          finish(data.event === 'run.failed' ? new Error(formatted || 'Hermes Agent run failed') : undefined);
        }
      };
    });
  }

  async function approveActiveRun(choice: 'once' | 'session' | 'always' | 'deny') {
    if (!activeHermesRun) return;
    if (!runApproval?.id) {
      setApprovalError('这次审批缺少 approval_id，请重新发起任务。');
      return;
    }
    setApprovalSubmitting(true);
    setApprovalError('');
    try {
      const res = await fetch(`/api/threads/${activeHermesRun.threadId}/runs/${activeHermesRun.runId}/approval`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ choice, approvalId: runApproval.id, sessionId: activeHermesRun.sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setApprovalError(data.error || '审批响应失败。');
        return;
      }
      if (data.resolved === false) {
        setApprovalError('这次审批已失效，请重新发起任务。');
        return;
      }
      setRunApproval(null);
    } finally {
      setApprovalSubmitting(false);
    }
  }

  async function respondToActiveClarification(action: 'answer' | 'skip', response = '') {
    if (!activeHermesRun || !runClarification) return;
    if (!runClarification.id) {
      setClarificationError('这次提问缺少 clarify_id，请重新发起任务。');
      return;
    }
    if (action === 'answer' && !response.trim()) {
      setClarificationError('请输入回答。');
      return;
    }
    setClarificationSubmitting(true);
    setClarificationError('');
    try {
      const res = await fetch(`/api/threads/${activeHermesRun.threadId}/runs/${activeHermesRun.runId}/clarify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clarifyId: runClarification.id, action, response: response.trim(), sessionId: activeHermesRun.sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.resolved === false) {
        setClarificationError(data.error || '这次提问已失效，请重新发起任务。');
        return;
      }
      setRunClarification(null);
    } finally {
      setClarificationSubmitting(false);
    }
  }

  async function stopActiveRun() {
    if (!activeHermesRun || runStopping) return;
    setRunStopping(true);
    setRunError('');
    try {
      const res = await fetch(`/api/threads/${activeHermesRun.threadId}/runs/${activeHermesRun.runId}/stop`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: activeHermesRun.sessionId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.resolved === false) {
        throw new Error(data.error || '这次运行已经结束或无法停止');
      }
    } catch (error) {
      setRunStopping(false);
      setRunError(error instanceof Error ? error.message : '停止运行失败，请重试。');
    }
  }

  async function startNewChat() {
    const text = newChatInput.trim();
    if (!text || isRunning) return;
    const startedAt = Date.now();
    setThreadFollowState(true);
    setIsRunning(true);
    setRunStartedAt(startedAt);
    const target = resolveRunTarget(text, agents, newChatAgent);
    setRunTarget(target);
    setCompletedRunSummary(null);
    try {
      const draftModelOverrides = newChatModelOverride && newChatAgent
        ? { [newChatAgent.id]: newChatModelOverride }
        : {};
      const created = selectedNewChatWorkspaceId
        ? await fetch(`/api/workspaces/${selectedNewChatWorkspaceId}/threads`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text.slice(0, 40) || '新的项目对话', agentModelOverrides: draftModelOverrides }),
        }).then((res) => res.json())
        : await fetch('/api/conversations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ primaryAgentId: newChatAgent?.id || 'iris', title: text.slice(0, 40) || `${newChatAgent?.name || 'Iris'} 对话`, agentModelOverrides: draftModelOverrides, spaceId: activeSpaceId }),
        }).then((res) => res.json());
      const thread = created.thread as Thread;
      await patchThreadPermission(thread.id, newChatPermissionMode, newChatProfileName);
      const localUserMessage = { id: `local-${Date.now()}`, agentId: 'user', agentName: '你', role: 'Workspace Owner', content: text };
      const optimisticThread = { ...thread, messages: [...thread.messages, localUserMessage] };
      setInput('');
      setNewChatInput('');
      setNewChatModelOverride('');
      setAttachments([]);
      setActiveView('thread');
      setActiveThread(optimisticThread);
      const runAgents = thread.selectedAgents || ['iris', ...(thread.mode === 'workspace' ? ['max'] : [])];
      try {
        await runHermesAgentThread(thread.id, text, runAgents, startedAt, target);
      } catch (error) {
        setRunError(error instanceof Error ? error.message : '本机 Hermes Bridge 未连接。');
        await refreshHermesRuntime();
      }
      await refreshLeftRail();
      if (thread.mode === 'workspace' && thread.workspaceId) await loadThreads(thread.workspaceId, thread.id);
    } finally {
      setIsRunning(false);
      setRunStartedAt(null);
      setRunTarget(null);
      setRunStopping(false);
      setActiveHermesRun(null);
    }
  }

  function openNewChatLauncher() {
    if (!closeProfileInspector()) return;
    setActiveNav('council');
    setActiveView('new-chat');
    setNewChatInput('');
    setNewChatAgentId('iris');
    setNewChatModelOverride('');
    setNewChatAgentPickerOpen(false);
    setSelectedNewChatWorkspaceId(null);
    setProjectPickerOpen(false);
    setNewChatPermissionMode(uiSettings.defaultPermissionMode || 'manual');
    setAttachments([]);
  }

  function openNavSection(sectionId: string) {
    if (!closeProfileInspector()) return;
    setActiveView('thread');
    setActiveNav(sectionId);
  }

  function openSettingsSection(section: SettingsSection = 'hermes') {
    if (!closeProfileInspector()) return;
    setUserMenuOpen(false);
    setSettingsSection(section);
    setActiveView('thread');
    setActiveNav('settings');
  }

  function returnFromSettings() {
    if (!closeProfileInspector()) return;
    setUserMenuOpen(false);
    if (activeThread) {
      setActiveNav('council');
      setActiveView('thread');
      return;
    }
    openNewChatLauncher();
  }

  async function openWorkspace(workspace: Workspace) {
    if (!closeProfileInspector()) return;
    if (workspace.spaceId && workspace.spaceId !== activeSpaceId) await switchSpace(workspace.spaceId);
    setActiveNav('council');
    setActiveView('thread');
    await loadThreads(workspace.id, workspace.activeThreadId);
  }

  async function openConversation(threadId: string) {
    if (!closeProfileInspector()) return;
    setActiveNav('council');
    setActiveView('thread');
    await openThread(threadId);
  }

  async function updateThreadVault(vaultId: string | null) {
    if (!activeThread) return;
    const data = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vaultId }),
    }).then((res) => res.json());
    setActiveThread(data.thread);
    await refreshLeftRail();
    if (data.thread.mode === 'workspace') await loadThreads(data.thread.workspaceId, data.thread.id);
  }

  async function updateThreadPermissionMode(permissionMode: PermissionMode) {
    if (!activeThread) return;
    const previousThread = activeThread;
    const data = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissionMode }),
    }).then((res) => res.json());
    setActiveThread(data.thread);
    await refreshLeftRail();
    try {
      await syncHermesApprovalMode(permissionMode, activeComposerProfileName);
    } catch (error) {
      setActiveThread(previousThread);
      setHermesError(error instanceof Error ? error.message : '操作权限同步失败。');
      return;
    }
  }

  async function addVault() {
    setVaultError('');
    const value = vaultPathInput.trim();
    if (!value) {
      setVaultError('请输入 Obsidian 仓库路径。');
      return;
    }
    const res = await fetch('/api/vaults', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: value }),
    });
    const data = await res.json();
    if (!res.ok) {
      setVaultError(data.error || '添加失败。');
      return;
    }
    setVaultPathInput('');
    const vaultData = await fetch('/api/vaults').then((r) => r.json());
    setVaults(vaultData.vaults);
    setDefaultVaultId(vaultData.defaultVaultId || data.vault.id);
    if (activeThread) await updateThreadVault(data.vault.id);
  }

  async function reindexVault(vaultId: string) {
    setVaultError('');
    setVaultBusy((current) => ({ ...current, [vaultId]: 'index' }));
    try {
      const res = await fetch(`/api/vaults/${vaultId}/index`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '索引更新失败。');
      const vaultData = await fetch('/api/vaults').then((response) => response.json());
      setVaults(vaultData.vaults || []);
      setDefaultVaultId(vaultData.defaultVaultId || null);
      if (activeThread?.vaultId === vaultId) await loadVaultSummary(vaultId);
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : '索引更新失败。');
    } finally {
      setVaultBusy((current) => {
        const next = { ...current };
        delete next[vaultId];
        return next;
      });
    }
  }

  async function deleteVault(vault: Vault) {
    const confirmed = window.confirm(`移除 Obsidian 仓库「${vault.name}」？\n\n仅移除 Frakio Work 中的连接和索引，不会删除电脑上的任何文件。`);
    if (!confirmed) return;
    setVaultError('');
    setVaultBusy((current) => ({ ...current, [vault.id]: 'delete' }));
    try {
      const res = await fetch(`/api/vaults/${vault.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '仓库移除失败。');

      setVaults((current) => current.filter((item) => item.id !== vault.id));
      setDefaultVaultId(data.defaultVaultId || null);
      setWorkspaces((current) => current.map((workspace) => workspace.vaultId === vault.id ? { ...workspace, vaultId: null } : workspace));
      setConversations((current) => current.map((thread) => thread.vaultId === vault.id ? { ...thread, vaultId: null, vaultName: '未连接资料库' } : thread));
      setThreads((current) => current.map((thread) => thread.vaultId === vault.id ? { ...thread, vaultId: null, vaultName: '未连接资料库' } : thread));
      setArchivedThreads((current) => current.map((thread) => thread.vaultId === vault.id ? { ...thread, vaultId: null, vaultName: '未连接资料库' } : thread));
      setActiveThread((current) => current?.vaultId === vault.id ? { ...current, vaultId: null, vaultName: '未连接资料库' } : current);
      if (activeThread?.vaultId === vault.id) setVaultSummary(null);
      await refreshLeftRail();
    } catch (error) {
      setVaultError(error instanceof Error ? error.message : '仓库移除失败。');
    } finally {
      setVaultBusy((current) => {
        const next = { ...current };
        delete next[vault.id];
        return next;
      });
    }
  }

  async function saveModel(payload: ModelPayload, modelId?: string) {
    setModelError('');
    const res = await fetch(modelId ? `/api/models/${modelId}` : '/api/models', {
      method: modelId ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      setModelError(data.error || '模型添加失败。');
      return false;
    }
    setModels(data.models);
    return true;
  }

  async function deleteModel(modelId: string) {
    setModelError('');
    const res = await fetch(`/api/models/${modelId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) {
      setModelError(data.error || '模型删除失败。');
      return false;
    }
    setModels(data.models || []);
    if (data.agents) setAgents(data.agents);
    return true;
  }

  async function fetchAvailableModels(baseUrl: string, apiKey: string) {
    const res = await fetch('/api/models/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '模型列表获取失败。');
    return data.models as string[];
  }

  async function refreshHermesStatus() {
    setHermesError('');
    const [localData, bootstrapData] = await Promise.all([
      fetch('/api/hermes-local/status').then((res) => res.json()).catch(() => null),
      fetch('/api/hermes-bootstrap/status').then((res) => res.json()).catch(() => null),
    ]);
    if (!localData && !bootstrapData) {
      setHermesApiAvailability('offline');
      setHermesError('Frakio Work 本地管理服务未运行。请确认 127.0.0.1:8787 已启动。');
      return null;
    }
    setHermesApiAvailability('online');
    if (localData && !localData.error) setHermesStatus(localData);
    if (bootstrapData && !bootstrapData.error) setHermesBootstrap(bootstrapData);
    if (localData?.error || bootstrapData?.error) setHermesError(localData?.error || bootstrapData?.error || 'Hermes 检测失败。');
    return localData as HermesLocalStatus;
  }

  async function importHermesProfiles() {
    setHermesError('');
    setIsImportingHermes(true);
    try {
      const res = await fetch('/api/hermes-bootstrap/import', { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setHermesError(data.error || '导入 Hermes Agent 失败。');
        return;
      }
      setAgents(data.agents || []);
      if (data.bootstrap) setHermesBootstrap(data.bootstrap);
      await refreshHermesStatus();
      await refreshOrg();
    } finally {
      setIsImportingHermes(false);
    }
  }

  async function sendMessage() {
    const text = input.trim();
    if (!text || isRunning || !activeThread) return;
    const startedAt = Date.now();
    setThreadFollowState(true);
    setIsRunning(true);
    setRunStartedAt(startedAt);
    const target = resolveRunTarget(text, agents, activeComposerAgent);
    setRunTarget(target);
    setCompletedRunSummary(null);
    setInput('');
    setAttachments([]);
    const optimisticThread = {
      ...activeThread,
      messages: [...activeThread.messages, { id: `local-user-${startedAt}`, agentId: 'user', agentName: '你', role: 'Workspace Owner', content: text }],
    };
    setActiveThread(optimisticThread);
    try {
      try {
        await runHermesAgentThread(activeThread.id, text, selectedAgentIds, startedAt, target);
      } catch (error) {
        setRunError(error instanceof Error ? error.message : '本机 Hermes Bridge 未连接。');
        await refreshHermesRuntime();
      }
      await refreshLeftRail();
      if (activeThread.mode === 'workspace' && activeThread.workspaceId) await loadThreads(activeThread.workspaceId, activeThread.id);
    } finally {
      setIsRunning(false);
      setRunStartedAt(null);
      setRunTarget(null);
      setRunStopping(false);
      setActiveHermesRun(null);
    }
  }

  function handleAttachmentChange(files: FileList | null) {
    const nextFiles = Array.from(files || []);
    if (!nextFiles.length) return;
    setAttachments((current) => [...current, ...nextFiles]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function removeAttachment(index: number) {
    setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function toggleAgent(agentId: string) {
    if (!activeThread || agentId === 'iris') return;
    const next = selectedAgentIds.includes(agentId)
      ? selectedAgentIds.filter((id) => id !== agentId)
      : [...selectedAgentIds, agentId];
    const data = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedAgents: next }),
    }).then((res) => res.json());
    setActiveThread(data.thread);
    await refreshLeftRail();
  }

  async function updateThreadAgentModelOverride(agentId: string, modelId: string) {
    if (!activeThread || !agentId) return;
    const nextOverrides = { ...(activeThread.agentModelOverrides || {}) };
    if (modelId && resolveModelChoice(modelId, models).model) nextOverrides[agentId] = resolveModelChoice(modelId, models).value;
    else delete nextOverrides[agentId];
    const normalizedOverrides = pruneAgentModelOverrides(nextOverrides, agents, models);
    const data = await fetch(`/api/threads/${activeThread.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentModelOverrides: normalizedOverrides }),
    }).then((res) => res.json());
    setActiveThread(data.thread);
    await refreshLeftRail();
  }

  async function refreshOrg() {
    const data = await fetch('/api/agents').then((res) => res.json());
    setAgents(data.agents);
  }

  async function createAgent(payload: Partial<Agent>) {
    const res = await fetch('/api/agents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok) {
      window.alert(data.error || 'Agent 创建失败。');
      return;
    }
    await refreshOrg();
    setSelectedOrgAgentId(data.agent.id);
    setNewAgentOpen(false);
  }

  async function deleteAgent(agentId: string) {
    const agent = agents.find((item) => item.id === agentId);
    if (!agent) return;
    const profileHint = agent.profileName ? `\n\n会同时删除本地 Profile：${agent.profileName}` : '';
    const ok = window.confirm(`删除 Agent「${agent.name}」？${profileHint}\n\n这个操作会删除本地资料，不能撤销。`);
    if (!ok) return;
    const res = await fetch(`/api/agents/${agentId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      window.alert(data.error || 'Agent 删除失败。');
      return;
    }
    setEditingAgentId(null);
    if (profileInspector.target?.agentId === agentId) closeProfileInspector(true);
    setSelectedOrgAgentId((current) => current === agentId ? data.agents?.[0]?.id || '' : current);
    await refreshOrg();
  }

  async function updateAgent(agentId: string, payload: Partial<Agent>) {
    const res = await fetch(`/api/agents/${agentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Agent 保存失败。');
    await refreshOrg();
  }

  function jumpToThreadRound(roundId: string) {
    const targetRound = overviewRounds.find((round) => round.id === roundId);
    if (!targetRound) return;
    isFollowingLatestRef.current = false;
    setIsFollowingLatest(false);
    setHasNewThreadContent(true);
    setActiveOverviewRoundId(roundId);
    messageRefs.current[targetRound.startMessageId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const cleanShell = launchPhase !== 'done' || showFirstUseGuide;

  return (
    <>
    {!cleanShell && (
    <div className={`app ${isDesktopShell ? 'desktop-shell' : ''} ${['org', 'settings', 'models', 'channels', 'plugins', 'kanban', 'jobs', 'monitoring'].includes(activeNav) || activeView === 'new-chat' || spaceCreateOpen ? 'management-mode' : ''} ${isSettingsNav ? 'settings-mode' : ''} ${spaceCreateOpen ? 'workspace-create-mode' : ''} ${rightRailKind ? 'has-right-rail' : ''} ${rightRailOpen ? 'right-rail-open' : ''} ${activeView === 'new-chat' && !spaceCreateOpen ? 'new-chat-mode' : ''} ${libraryCollapsed ? 'library-collapsed' : ''} ${autoSidebarCollapsed && !spaceCreateOpen ? 'sidebar-auto-collapsed' : ''} ${(isDesktopShell || isSettingsNav) && effectiveSidebarCollapsed && !spaceCreateOpen ? 'sidebar-collapsed' : ''} ${uiSettings.density === 'compact' ? 'compact-density' : ''}`} style={appStyle}>
      {isDesktopShell && !isSettingsNav && (
        <>
          <div className="desktop-window-controls">
            <button
              className="desktop-window-control"
              onClick={toggleDesktopSidebar}
              aria-label={effectiveSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
              title={effectiveSidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
            >
              {effectiveSidebarCollapsed ? <PanelLeftOpen size={14} /> : <PanelLeftClose size={14} />}
            </button>
            <button className="desktop-window-control" onClick={openNewChatLauncher} aria-label="新对话" title="新对话">
              <Pencil size={14} />
            </button>
          </div>
          {rightRailKind && (
            <button
              className={rightRailOpen ? 'desktop-window-control desktop-right-rail-toggle active' : 'desktop-window-control desktop-right-rail-toggle'}
              onClick={() => void persistUi({ libraryCollapsed: rightRailOpen })}
              aria-label={rightRailOpen ? '收起资源' : '展开资源'}
              title={rightRailOpen ? '收起资源' : '展开资源'}
            >
              {rightRailOpen ? <PanelRightOpen size={15} /> : <PanelRight size={15} />}
            </button>
          )}
        </>
      )}
      {isSettingsNav ? (
        <SettingsRail
          activeSection={settingsSection}
          onSectionChange={changeSettingsSection}
          onReturnToConversation={returnFromSettings}
        />
      ) : (
        <aside
          className={spaceCreateOpen ? 'sidebar workspace-create-rail' : 'sidebar'}
          data-rail-tone={spaceCreateOpen && hexLuminance(spaceDraft.theme.sidebarBg) > 0.72 ? 'light' : 'dark'}
          style={spaceCreateOpen ? {
            '--draft-accent': spaceDraft.theme.accentColor,
            '--draft-sidebar-bg': spaceDraft.theme.sidebarBg,
            '--draft-secondary-a': normalizeGradientColors(spaceDraft.theme)[1]?.color || spaceDraft.theme.sidebarBg,
            '--draft-secondary-b': normalizeGradientColors(spaceDraft.theme)[2]?.color || spaceDraft.theme.accentColor,
            '--draft-theme-bg': themeGradientBackground(spaceDraft.theme),
            '--draft-stage-bg': themeStageBackground(spaceDraft.theme),
            '--draft-rail-bg': themeRailBackground(spaceDraft.theme),
            '--draft-noise': String(spaceDraft.theme.noise),
            '--draft-texture': String(spaceDraft.theme.texture ?? 0),
            '--draft-opacity': String(spaceDraft.theme.opacity),
            ...textureSurfaceVars(spaceDraft.theme, 'rail'),
          } as React.CSSProperties : undefined}
        >
          {spaceCreateOpen ? (
            <>
              <div className="workspace-create-rail-head">
                <div className="workspace-create-window-dots" aria-hidden="true"><i /><i /><i /></div>
                <div className="workspace-create-window-tools">
                  <button onClick={closeSpaceEditor} aria-label="返回" title="返回"><ArrowLeft size={14} /></button>
                  <button onClick={() => setSpaceDraft((current) => ({ ...current, name: '' }))} aria-label="清空名称" title="清空名称"><RefreshCw size={13} /></button>
                </div>
                <span className="workspace-create-icon">
                  <img src={frakioBrandLogoUrl} alt="" />
                </span>
                <h2>{spaceEditTargetId ? 'Edit Space' : 'Create a Space'}</h2>
                <p>{spaceEditTargetId ? 'Adjust this space theme, icon, and identity.' : 'Separate your tabs for life, work, projects, and more.'}</p>
              </div>
              <div className="workspace-create-rail-body">
                <label className="workspace-name-field">
                  <button type="button" onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: current.iconKind === 'dot' ? 'emoji' : current.iconKind === 'emoji' ? 'icon' : 'dot', iconValue: current.iconKind === 'dot' ? '✨' : current.iconKind === 'emoji' ? 'folder' : '' }))} aria-label="切换工作区图标">{renderDraftIcon(14)}</button>
                  <input autoFocus value={spaceDraft.name} onChange={(event) => setSpaceDraft((current) => ({ ...current, name: event.target.value }))} placeholder="Space name..." />
                </label>
                <div className="workspace-icon-picker">
                  <div className="workspace-picker-tabs">
                    <button className={spaceDraft.iconKind === 'dot' ? 'selected' : ''} onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: 'dot', iconValue: '' }))}>Dot</button>
                    <button className={spaceDraft.iconKind === 'emoji' ? 'selected' : ''} onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: 'emoji', iconValue: current.iconValue || '✨' }))}>Emoji</button>
                    <button className={spaceDraft.iconKind === 'icon' ? 'selected' : ''} onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: 'icon', iconValue: 'folder' }))}>Icon</button>
                  </div>
                  <div className={spaceDraft.iconKind === 'dot' ? 'dot-choice-grid' : spaceDraft.iconKind === 'emoji' ? 'emoji-grid' : 'emoji-grid icon-grid'}>
                    {spaceDraft.iconKind === 'dot' ? (
                      <button className="selected" onClick={() => setSpaceDraft((current) => ({ ...current, iconKind: 'dot', iconValue: '' }))}><span className="field-dot" /></button>
                    ) : (spaceDraft.iconKind === 'emoji' ? spaceEmojiOptions : spaceIconOptions).map((item) => (
                      <button className={spaceDraft.iconValue === item ? 'selected' : ''} key={item} onClick={() => setSpaceDraft((current) => ({ ...current, iconValue: item }))} title={spaceDraft.iconKind === 'icon' ? spaceIconLabels[item] : item}>
                        {spaceDraft.iconKind === 'emoji' ? item : item === 'briefcase' ? <Briefcase size={17} /> : item === 'sparkles' ? <Sparkles size={17} /> : item === 'library' ? <Library size={17} /> : <Folder size={17} />}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="workspace-create-hint">
                  <Pencil size={14} />
                  <strong>Choose a Theme</strong>
                  <ChevronRight size={14} />
                </div>
              </div>
              <div className="workspace-create-rail-actions">
                <button className="send-btn workspace-create-submit" disabled={!spaceDraft.name.trim()} onClick={() => void submitSpaceDraft()}>{spaceEditTargetId ? 'Save Space' : 'Create Space'}</button>
                <button className="workspace-create-cancel" onClick={closeSpaceEditor}>Cancel</button>
                <div className="workspace-create-space-dots" aria-label="工作区位置预览">
                  {spaces.map((space) => {
                    const isEditingSpace = space.id === spaceEditTargetId;
                    const theme = isEditingSpace ? spaceDraft.theme : normalizeSpaceTheme(space.theme);
                    const kind = isEditingSpace ? spaceDraft.iconKind : spaceIconKind(space);
                    return (
                      <button
                        className={`${space.id === activeSpaceId ? 'active' : ''} ${kind === 'dot' ? 'dot-space' : ''}`}
                        key={space.id}
                        style={{ '--space-accent': theme.accentColor } as React.CSSProperties}
                        type="button"
                        aria-label={space.name}
                      >
                        {isEditingSpace ? renderDraftIcon(15) : <SpaceIconGlyph space={space} />}
                      </button>
                    );
                  })}
                  {!spaceEditTargetId && (
                    <button
                      className={`draft ${spaceDraft.iconKind === 'dot' ? 'dot-space' : ''}`}
                      type="button"
                      style={{ '--space-accent': spaceDraft.theme.accentColor } as React.CSSProperties}
                      aria-label="当前创建的工作区"
                    >
                      {renderDraftIcon(15)}
                    </button>
                  )}
                </div>
              </div>
            </>
          ) : (
          <>
          <div className="rail-actions">
            <button className={activeView === 'new-chat' ? 'rail-action active' : 'rail-action'} onClick={openNewChatLauncher} title="新对话"><Plus size={16} /><span>新对话</span></button>
            <button className="rail-action" title="搜索"><Search size={16} /><span>搜索</span></button>
            {visiblePinnedNav.map((item) => {
              const Icon = item.icon;
              return (
                <button className={activeNav === item.id && activeView !== 'new-chat' ? 'rail-action active' : 'rail-action'} key={item.id} onClick={() => openNavSection(item.id)} title={item.label} aria-label={item.label}>
                  <Icon size={16} /><span>{item.label}</span>
                </button>
              );
            })}
          </div>
          <div className="space-divider" />
          <div className={`space-content-viewport switching-${spaceSwitchDirection}`}>
          <div className="sidebar-scroll" key={activeSpaceId}>
            <section className="rail-section">
              <div className="rail-section-head"><span>项目</span><button className="mini-add" onClick={() => openProjectModal('create')} aria-label="新建项目"><Plus size={14} /></button></div>
              <div className="rail-list">
                {visibleWorkspaces.length ? visibleWorkspaces.map((workspace) => {
                  const workspaceThreads = workspace.threads || [];
                  const hasThreads = workspaceThreads.length > 0;
                  const collapsed = (uiSettings.collapsedWorkspaceIds || []).includes(workspace.id);
                  return (
                    <div className={activeView !== 'new-chat' && workspace.id === activeThread?.workspaceId && activeThread?.mode === 'workspace' ? 'rail-item project active' : 'rail-item project'} key={workspace.id} onContextMenu={(event) => openRailContextMenu(event, { kind: 'workspace', workspace })}>
                      {hasThreads && (
                        <button
                          className="project-collapse-toggle"
                          onClick={(event) => { event.stopPropagation(); toggleWorkspaceCollapsed(workspace.id); }}
                          aria-label={collapsed ? `展开项目 ${workspace.name}` : `收起项目 ${workspace.name}`}
                          aria-expanded={!collapsed}
                          title={collapsed ? '展开项目' : '收起项目'}
                        >
                          {collapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
                        </button>
                      )}
                      {!hasThreads && <Folder className="project-folder-icon" size={14} aria-hidden="true" />}
                      <button className="rail-main project-main" onClick={() => void openWorkspace(workspace)} aria-label={`项目 ${workspace.name}`}>
                        <strong>{workspace.name}</strong>
                      </button>
                      <button
                        className="rail-more-button"
                        onClick={(event) => openRailContextMenu(event, { kind: 'workspace', workspace })}
                        aria-label={`更多项目操作：${workspace.name}`}
                        title="更多"
                      >
                        <MoreHorizontal size={15} />
                      </button>
                      {hasThreads && !collapsed && (
                        <div className="project-thread-list">
                          {workspaceThreads.map((thread) => (
                            <div className={activeView !== 'new-chat' && thread.id === activeThread?.id ? 'rail-subitem active' : 'rail-subitem'} key={thread.id} onContextMenu={(event) => openRailContextMenu(event, { kind: 'thread', thread })}>
                              <ThreadRailContent thread={thread} agents={agents} onOpen={() => void openConversation(thread.id)} onMore={(event) => openRailContextMenu(event, { kind: 'thread', thread })} />
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                }) : <div className="empty-rail">这个工作区还没有项目。</div>}
              </div>
            </section>

            <section className="rail-section">
              <div className="rail-section-head"><span>对话</span><button className="mini-add" onClick={openNewChatLauncher} aria-label="新建单聊"><Plus size={14} /></button></div>
              <div className="rail-list">
                {visibleConversations.length ? visibleConversations.map((thread) => (
                  <div className={activeView !== 'new-chat' && thread.id === activeThread?.id ? 'rail-item active' : 'rail-item'} key={thread.id} onContextMenu={(event) => openRailContextMenu(event, { kind: 'thread', thread })}>
                    <ThreadRailContent thread={thread} agents={agents} onOpen={() => void openConversation(thread.id)} onMore={(event) => openRailContextMenu(event, { kind: 'thread', thread })} />
                  </div>
                )) : <div className="empty-rail">这个工作区还没有单 Agent 对话。</div>}
              </div>
            </section>
          </div>
          </div>
          <div className="space-switcher">
            <div className="space-switcher-list">
              {spaces.map((space) => (
                <button
                  className={`${space.id === activeSpaceId ? 'space-pill active' : 'space-pill'} ${spaceIconKind(space) === 'dot' ? 'dot-space' : ''}`}
                  key={space.id}
                  onClick={() => void switchSpace(space.id)}
                  onContextMenu={(event) => openRailContextMenu(event, { kind: 'space', space })}
                  title={space.name}
                  aria-label={`切换到工作区 ${space.name}`}
                >
                  <SpaceIconGlyph space={space} />
                </button>
              ))}
              <div className="space-add-wrap">
                <button className="space-pill add" onClick={() => setSpaceMenuOpen((open) => !open)} aria-label="新建工作区" title="新建工作区"><Plus size={15} /></button>
                {spaceMenuOpen && (
                  <div className="space-add-menu">
                    <button onClick={openSpaceCreate}>New Workspace</button>
                  </div>
                )}
              </div>
            </div>
          </div>
          <div className="sidebar-footer">
            <div className="user-menu-anchor" ref={userMenuRef}>
              <button className={userMenuOpen ? 'user-card active' : 'user-card'} onClick={() => setUserMenuOpen((open) => !open)} aria-expanded={userMenuOpen} aria-label="打开用户菜单">
                <span className="user-avatar">{userProfile.avatarUrl ? <img src={userProfile.avatarUrl} alt="" /> : (userProfile.nickname || 'MG').slice(0, 2).toUpperCase()}</span>
                <span><strong>{userProfile.nickname || 'Frakio User'}</strong><em>Local Web UI</em></span>
              </button>
              {userMenuOpen && (
                <div className="user-menu-popover">
                  <button onClick={() => openSettingsSection('profile')}><UserCircle size={16} /><span>个人资料</span></button>
                  <button onClick={() => openSettingsSection('hermes')}><Settings size={16} /><span>设置</span></button>
                </div>
              )}
            </div>
          </div>
          </>
          )}
        </aside>
      )}
      {railContextMenu && (
        <RailContextMenu
          target={railContextMenu}
          canShowInFinder={Boolean(window.frakioDesktop?.showItemInFolder)}
          onClose={() => setRailContextMenu(null)}
          onToggleWorkspacePinned={toggleWorkspacePinned}
          onRenameWorkspace={renameWorkspace}
          onArchiveWorkspace={(workspace) => void archiveWorkspace(workspace.id)}
          onShowInFinder={showInFinder}
          onCopyText={copyText}
          onEditSpace={openSpaceEditor}
          onToggleThreadPinned={toggleThreadPinned}
          onRenameThread={renameThread}
          onArchiveThread={(thread) => void archiveThread(thread.id)}
          onDeleteWorkspace={(workspace) => openRailDeleteConfirmFromMenu({ kind: 'workspace', id: workspace.id, title: workspace.name })}
          onDeleteThread={(thread) => openRailDeleteConfirmFromMenu({ kind: 'thread', id: thread.id, title: thread.title })}
        />
      )}
      {railConfirm && <RailConfirmPopover target={railConfirm} onCancel={() => setRailConfirm(null)} onConfirm={() => confirmRailAction(railConfirm)} />}
      <ResizeHandle
        side="left"
        disabled={isDesktopShell && effectiveSidebarCollapsed}
        onResize={setSidebarWidth}
        onCommit={(width) => void persistUi({ sidebarWidth: width })}
      />

      <main className="main">
        {activeView !== 'new-chat' && !isSettingsNav && !spaceCreateOpen && <header className="topbar">
          <div className="topbar-title">
            <span className="topbar-title-icon"><FileText size={17} /></span>
            <h1>{isManagementSection ? activeSection?.label : activeThread?.title || activeSection?.label || '新对话'}</h1>
          </div>
          {!isManagementSection && activeThread && (
            <div className="top-actions">
              <ThreadActionsMenu
                thread={activeThread}
                workspace={activeWorkspace}
                vaults={vaults}
                activeVault={activeVault}
                activeAgent={activeComposerAgent}
                onFollowModeChange={updateThreadFollowMode}
                onCreateProjectThread={createThread}
                onConvertToProject={() => openProjectModal('create', 'convert')}
                onVaultChange={updateThreadVault}
                onOpenAgents={() => setAgentPickerOpen(true)}
              />
              {!isDesktopShell && rightRailKind && (
                <button
                  className={rightRailOpen ? 'top-icon-btn active' : 'top-icon-btn'}
                  onClick={() => void persistUi({ libraryCollapsed: rightRailOpen })}
                  aria-label={rightRailOpen ? '收起资源' : '展开资源'}
                  title={rightRailOpen ? '收起资源' : '展开资源'}
                >
                  {rightRailOpen ? <PanelRightOpen size={17} /> : <PanelRight size={17} />}
                </button>
              )}
            </div>
          )}
        </header>}

        {spaceCreateOpen ? (
          <section
            className="workspace-create-stage"
            style={{
              '--draft-accent': spaceDraft.theme.accentColor,
              '--draft-sidebar-bg': spaceDraft.theme.sidebarBg,
              '--draft-secondary-a': normalizeGradientColors(spaceDraft.theme)[1]?.color || spaceDraft.theme.sidebarBg,
              '--draft-secondary-b': normalizeGradientColors(spaceDraft.theme)[2]?.color || spaceDraft.theme.accentColor,
              '--draft-theme-bg': themeGradientBackground(spaceDraft.theme),
              '--draft-stage-bg': themeStageBackground(spaceDraft.theme),
              '--draft-rail-bg': themeRailBackground(spaceDraft.theme),
              '--draft-noise': String(spaceDraft.theme.noise),
              '--draft-texture': String(spaceDraft.theme.texture ?? 0),
              '--draft-opacity': String(spaceDraft.theme.opacity),
              ...textureSurfaceVars(spaceDraft.theme, 'stage'),
            } as React.CSSProperties}
          >
            <div className="workspace-theme-panel">
              <div
                className="theme-dot-matrix"
                onPointerDown={handleThemePanelPointer}
                onPointerMove={(event) => { if (event.buttons === 1) handleThemePanelPointer(event); }}
                aria-label="选择工作区颜色"
                role="application"
              >
                <span className="theme-picker-toolbar" onPointerDown={(event) => event.stopPropagation()}>
                  <button type="button" className={(spaceDraft.theme.appearance || 'light') === 'auto' ? 'selected' : ''} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); setDraftThemeAppearance('auto'); }} aria-label="自动主题"><Sparkles size={14} /></button>
                  <button type="button" className={(spaceDraft.theme.appearance || 'light') === 'light' ? 'selected' : ''} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); setDraftThemeAppearance('light'); }} aria-label="白天主题"><Sun size={14} /></button>
                  <button type="button" className={(spaceDraft.theme.appearance || 'light') === 'dark' ? 'selected' : ''} onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); setDraftThemeAppearance('dark'); }} aria-label="夜晚主题"><Moon size={14} /></button>
                </span>
                {normalizeGradientColors(spaceDraft.theme).map((color) => (
                  <button
                    className={color.isPrimary ? 'theme-picker-cursor primary' : 'theme-picker-cursor'}
                    key={color.id}
                    onPointerDown={(event) => handleThemeDotPointer(event, color.id)}
                    onPointerMove={(event) => handleThemeDotMove(event, color.id)}
                    onPointerUp={finishThemeDotPointer}
                    onPointerCancel={finishThemeDotPointer}
                    onClick={(event) => { event.stopPropagation(); promoteDraftThemeColor(color.id); }}
                    style={{ left: `${color.x * 100}%`, top: `${color.y * 100}%`, background: color.color }}
                    aria-label={color.isPrimary ? '主色' : '设为主色'}
                    type="button"
                  />
                ))}
                <span className="theme-picker-controls" onPointerDown={(event) => event.stopPropagation()}>
                  <button type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); removeDraftThemeColor(); }} disabled={normalizeGradientColors(spaceDraft.theme).length <= 1} aria-label="减少颜色">-</button>
                  <button type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); addDraftThemeColor(); }} disabled={normalizeGradientColors(spaceDraft.theme).length >= 3} aria-label="增加颜色">+</button>
                  <button type="button" onPointerDown={(event) => { event.preventDefault(); event.stopPropagation(); }} onClick={(event) => { event.stopPropagation(); randomizeDraftThemeColors(); }} aria-label="随机颜色"><Sparkles size={13} /></button>
                </span>
              </div>
              <div className="theme-color-row">
                <button className="theme-step-btn" onClick={() => changeThemePresetPage(-1)} aria-label="上一页颜色" disabled={themePresetPage === 0}><ChevronDown size={16} /></button>
                <div className="theme-color-pages">
                {themePresetPage === 0 && (
                  <button
                    className={selectedThemePresetId === 'frakio-default' ? 'selected theme-default-preset' : 'theme-default-preset'}
                    style={{ '--preset-1': defaultProductSpaceTheme.accentColor, '--preset-2': defaultProductSpaceTheme.sidebarBg, '--preset-3': '#ffffff', background: defaultProductSpaceTheme.sidebarBg } as React.CSSProperties}
                    onClick={applyDefaultThemePreset}
                    aria-label="选择默认主题"
                  />
                )}
                {themePresetPages[themePresetPage].map((preset) => (
                  <button
                    className={`${selectedThemePresetId === preset.id ? 'selected ' : ''}${preset.colors.length > 1 ? 'multi' : 'solid'}`}
                    key={preset.id}
                    style={{ '--preset-1': preset.colors[0], '--preset-2': preset.colors[1] || preset.colors[0], '--preset-3': preset.colors[2] || preset.colors[0], background: preset.colors[0] } as React.CSSProperties}
                    onClick={() => applyThemePreset(preset)}
                    aria-label={`选择 Zen 颜色 ${preset.id}`}
                  />
                ))}
                </div>
                <button className="theme-step-btn next" onClick={() => changeThemePresetPage(1)} aria-label="下一页颜色" disabled={themePresetPage === themePresetPages.length - 1}><ChevronDown size={16} /></button>
              </div>
              <div className="theme-controls-row">
                <label className="theme-wave-slider" style={{ '--wave-progress': `${opacityProgress(spaceDraft.theme.opacity) * 100}%`, '--wave-thumb-height': `${40 + opacityProgress(spaceDraft.theme.opacity) * 15}px`, '--wave-thumb-width': `${10 + opacityProgress(spaceDraft.theme.opacity) * 15}px` } as React.CSSProperties}>
                  <span className="theme-wave-track">
                    <svg viewBox="0 -8 455 70" aria-hidden="true"><path d={wavePathForOpacity(spaceDraft.theme.opacity)} /></svg>
                    <input type="range" min="0.3" max="0.9" step="0.001" value={spaceDraft.theme.opacity} onChange={(event) => setSpaceDraft((current) => ({ ...current, theme: { ...current.theme, opacity: Number(event.target.value) } }))} />
                  </span>
                </label>
                <div
                  className="theme-noise-dial"
                  onPointerDown={handleTexturePointerDown}
                  onPointerMove={handleTexturePointerMove}
                  onPointerUp={finishTexturePointer}
                  onPointerCancel={finishTexturePointer}
                  style={{ '--texture': String(spaceDraft.theme.texture ?? 0) } as React.CSSProperties}
                  role="slider"
                  aria-label="噪点"
                  aria-valuemin={0}
                  aria-valuemax={16}
                  aria-valuenow={Math.round((spaceDraft.theme.texture ?? 0) * 16)}
                >
                  <div className="theme-texture-ring" aria-hidden="true">
                    {textureStepDots(spaceDraft.theme.texture).map((dot) => <i className={dot.active ? 'active' : ''} key={dot.id} style={{ left: `${dot.left}%`, top: `${dot.top}%` }} />)}
                    <b style={textureHandleStyle(spaceDraft.theme.texture)} />
                  </div>
                </div>
              </div>
              <div className="theme-mode-toggle">
                <button className={spaceDraft.theme.mode === 'soft' ? 'selected' : ''} onClick={() => setDraftThemeMode('soft')}>柔和</button>
                <button className={spaceDraft.theme.mode === 'crisp' ? 'selected' : ''} onClick={() => setDraftThemeMode('crisp')}>清晰</button>
              </div>
            </div>
          </section>
        ) : activeView === 'new-chat' ? (
          <section className="new-chat-page">
            <div className="new-chat-center">
              <h1>{uiSettings.newChatPrompt || '我们接下来做点什么？'}</h1>
              {newChatAgent && (
                <div className="new-chat-agent-wrap">
                  <button className="new-chat-agent-chip" onClick={() => setNewChatAgentPickerOpen((open) => !open)} aria-expanded={newChatAgentPickerOpen}>
                    <span className="agent-mention-symbol">@</span>
                    <AgentAvatar agent={newChatAgent} size="sm" />
                    <span><strong>{newChatAgent.name}</strong><small>{newChatAgent.role}</small></span>
                    <ChevronDown size={14} />
                  </button>
                  {newChatAgentPickerOpen && (
                    <div className="new-chat-agent-menu">
                      {agents.map((agent) => (
                        <button className={agent.id === newChatAgent.id ? 'selected' : ''} key={agent.id} onClick={() => { setNewChatAgentId(agent.id); setNewChatModelOverride(''); setNewChatAgentPickerOpen(false); }}>
                          <AgentAvatar agent={agent} size="sm" />
                          <span><strong>{agent.name}</strong><small>{agent.role}</small></span>
                          <em>{agentDefaultModelLabel(agent, models)}</em>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <div className="composer new-chat-composer">
                <MentionTextarea
                  value={newChatInput}
                  onChange={setNewChatInput}
                  onSend={() => void startNewChat()}
                  sendKey={uiSettings.sendKey || 'enter'}
                  agents={agents}
                  selectedAgentIds={[newChatAgent?.id || globalDefaultAgentId].filter(Boolean)}
                  placeholder="随意输入，随意@"
                />
                <div className="composer-toolbar">
                  <div className="composer-left-tools">
                    <button className="icon-btn composer-tool upload" onClick={() => fileInputRef.current?.click()} aria-label="上传附件" title="上传附件"><Plus size={19} /></button>
                    <input ref={fileInputRef} className="file-input" type="file" multiple onChange={(event) => handleAttachmentChange(event.target.files)} />
                    <PermissionModeControl value={newChatPermissionMode} onChange={setNewChatPermissionMode} />
                  </div>
                  <div className="composer-right-tools">
                    <ProviderModelPicker
                      className="composer-model composer-agent-model"
                      agentName={newChatAgent?.name || ''}
                      value={newChatProfileModelValue}
                      models={hermesProfileModelOptions}
                      emptyLabel={profileModelLabel(newChatProfileName, localProfilesForComposer)}
                      ariaLabel={newChatAgent ? `${newChatAgent.name} 的 Hermes Profile 模型` : 'Hermes Profile 模型'}
                      title={newChatAgent ? `Profile：${newChatProfileName}` : 'Hermes Profile 模型'}
                      allowDefault
                      usingDefault={!newChatModelOverride}
                      onChange={setNewChatModelOverride}
                    />
                    <ComposerRunButton
                      isRunning={isRunning}
                      hasActiveRun={Boolean(activeHermesRun)}
                      isStopping={runStopping}
                      canSend={Boolean(newChatInput.trim())}
                      onSend={() => void startNewChat()}
                      onStop={() => void stopActiveRun()}
                    />
                  </div>
                </div>
                {attachments.length > 0 && (
                  <div className="attachment-chips" aria-label="已选择附件">
                    {attachments.map((file, index) => (
                      <span className="attachment-chip" key={`${file.name}-${file.size}-${index}`}>
                        <span>{file.name}</span>
                        <small>{formatFileSize(file.size)}</small>
                        <button onClick={() => removeAttachment(index)} aria-label={`移除 ${file.name}`}><X size={12} /></button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="new-chat-project">
                <button className="new-chat-project-row" onClick={() => setProjectPickerOpen((open) => !open)} aria-expanded={projectPickerOpen}>
                  <FolderOpen size={16} />
                  <span>{selectedNewChatWorkspaceId ? visibleWorkspaces.find((workspace) => workspace.id === selectedNewChatWorkspaceId)?.name || 'Choose project' : 'Choose project'}</span>
                  <ChevronDown size={14} />
                </button>
                {projectPickerOpen && (
                  <div className="project-picker-menu">
                    <button className={!selectedNewChatWorkspaceId ? 'selected' : ''} onClick={() => { setSelectedNewChatWorkspaceId(null); setProjectPickerOpen(false); }}>
                      <MessageSquare size={15} />
                      <span><strong>临时对话</strong><small>不绑定项目目录</small></span>
                    </button>
                    {visibleWorkspaces.map((workspace) => (
                      <button className={selectedNewChatWorkspaceId === workspace.id ? 'selected' : ''} key={workspace.id} onClick={() => { setSelectedNewChatWorkspaceId(workspace.id); setProjectPickerOpen(false); }}>
                        <FolderOpen size={15} />
                        <span><strong>{workspace.name}</strong><small>{workspace.id === activeWorkspace?.id ? '当前项目 · ' : ''}{workspace.rootPath}</small></span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        ) : activeNav === 'settings' ? (
          <SettingsPage
            vaults={vaults}
            models={models}
            agents={agents}
            hermesStatus={hermesStatus}
            hermesBootstrap={hermesBootstrap}
            hermesRuntime={hermesRuntime}
            hermesDiagnostics={hermesDiagnostics}
            hermesApiAvailability={hermesApiAvailability}
            hermesError={hermesError}
            updatesStatus={updatesStatus}
            updatesBusy={updatesBusy}
            updatesError={updatesError}
            updatesResult={updatesResult}
            onCheckUpdates={() => runUpdateAction('check')}
            onUpdateHermesAgent={() => runUpdateAction('hermes-agent')}
            onUpdateFrakioWork={() => runUpdateAction('frakio-work')}
            onCheckHermesRuntime={checkHermesRuntimeUpdate}
            onInstallHermesRuntime={installHermesRuntime}
            onActivateHermesRuntime={activateHermesRuntime}
            onUseBundledHermesRuntime={useBundledHermesRuntime}
            onDeleteHermesRuntime={deleteHermesRuntime}
            onCreateHermesBackup={createHermesBackup}
            onRollbackHermesBackup={rollbackHermesBackup}
            onDeleteHermesBackup={deleteHermesBackup}
            onCleanupHermesBackups={cleanupHermesBackups}
            userProfile={userProfile}
            uiSettings={uiSettings}
            telemetryStatus={telemetryStatus}
            isImportingHermes={isImportingHermes}
            vaultPathInput={vaultPathInput}
            setVaultPathInput={setVaultPathInput}
            vaultError={vaultError}
            vaultBusy={vaultBusy}
            addVault={addVault}
            reindexVault={reindexVault}
            deleteVault={deleteVault}
            onImportHermes={importHermesProfiles}
            onRunFirstUseGuide={() => runFirstUseGuide({ manual: true })}
            firstUseGuideRunning={firstUseGuide.status === 'running'}
            onStartHermesRuntime={startHermesRuntime}
            onRefreshHermesRuntime={refreshHermesRuntime}
            onStartProfileGateway={startHermesProfileGateway}
            onUpdateUi={(next) => void persistUi(next)}
            onUserProfileSaved={(profile, nextAgents) => {
              setUserProfile(profile);
              if (nextAgents) setAgents(nextAgents);
            }}
            pinnedNav={pinnedNav}
            onTogglePinned={(id) => {
              const next = { ...pinnedNav, [id]: pinnedNav[id] === false };
              void persistUi({ pinnedNav: next });
            }}
            modelError={modelError}
            saveModel={saveModel}
            deleteModel={deleteModel}
            fetchAvailableModels={fetchAvailableModels}
            activeSection={settingsSection}
            archivedThreads={archivedThreads}
            onRefreshArchivedThreads={refreshArchivedThreads}
            onRestoreThread={restoreThread}
            onDeleteThread={deleteThread}
            selectedOrgAgentId={selectedOrgAgentId}
            onSelectAgent={selectOrgAgent}
            onProfilesChanged={refreshOrg}
            onUpdateAgent={updateAgent}
            onDeleteAgent={deleteAgent}
            onCreateAgent={() => setNewAgentOpen(true)}
            profileEditor={profileEditorControls}
            onUpdateDefaultAgent={(agentId) => {
              setNewChatAgentId(agentId);
              void persistUi({ defaultAgentId: agentId });
            }}
          />
        ) : activeNav === 'models' ? (
          <ModelConfigPage models={models} profiles={localProfilesForComposer} defaultProfile={defaultAgentProfileName || uiSettings.defaultProfile || 'default'} modelError={modelError} saveModel={saveModel} deleteModel={deleteModel} fetchAvailableModels={fetchAvailableModels} />
        ) : activeNav === 'channels' ? (
          <ChannelsPage profiles={hermesBootstrap?.profiles.length ? hermesBootstrap.profiles : hermesStatus?.profiles || []} defaultProfile={defaultAgentProfileName || uiSettings.defaultProfile || hermesBootstrap?.approval.profileName || 'default'} />
        ) : activeNav === 'plugins' ? (
          <PluginsPage agents={agents} profiles={hermesBootstrap?.profiles.length ? hermesBootstrap.profiles : hermesStatus?.profiles || []} />
        ) : activeNav === 'kanban' ? (
          <KanbanPage agents={agents} />
        ) : activeNav === 'jobs' ? (
          <JobsPage profiles={hermesBootstrap?.profiles.length ? hermesBootstrap.profiles : hermesStatus?.profiles || []} defaultProfile={defaultAgentProfileName || uiSettings.defaultProfile || hermesBootstrap?.approval.profileName || 'default'} />
        ) : activeNav === 'monitoring' ? (
          <MonitoringPage />
        ) : activeNav === 'org' ? (
          <OrgPage
            agents={agents}
            models={models}
            hermesRuntime={hermesRuntime}
            selectedOrgAgentId={selectedOrgAgentId}
            onSelectAgent={selectOrgAgent}
            onProfilesChanged={refreshOrg}
            onUpdateAgent={updateAgent}
            onDeleteAgent={deleteAgent}
            onCreate={() => setNewAgentOpen(true)}
            profileEditor={profileEditorControls}
            defaultAgentId={globalDefaultAgentId}
            onUpdateDefaultAgent={(agentId) => {
              setNewChatAgentId(agentId);
              void persistUi({ defaultAgentId: agentId });
            }}
            onRefreshHermesRuntime={refreshHermesRuntime}
            onStartProfileGateway={startHermesProfileGateway}
          />
        ) : (
          <>
            <section className="council">
              <div className="thread" ref={threadScrollRef}>
                <div className="thread-content" ref={threadContentRef}>
                {visibleMessages.map((message) => (
                  <div
                    className="message-anchor"
                    data-message-id={message.id}
                    key={message.id}
                    ref={(node) => { messageRefs.current[message.id] = node; }}
                  >
                    {activeCompletedRunSummary?.beforeMessageId === message.id && <CompletedRunStatus summary={activeCompletedRunSummary} />}
                    <article className={message.agentId === 'user' ? 'message user has-user-identity' : 'message'}>
                      {message.agentId !== 'user' && <MessageAvatar message={message} agents={agents} />}
                      <div className="message-body">
                        {message.agentId !== 'user' && <div className="message-meta"><strong>{message.agentName}</strong></div>}
                        {message.agentId === 'user' ? (
                          <p className="message-text">{message.content}</p>
                        ) : (
                          <MarkdownMessage content={animatedMessageContent[message.id] ?? message.content} streaming={Boolean(streamingMessageIds[message.id])} />
                        )}
                      </div>
                      {message.agentId === 'user' && <MessageAvatar message={message} agents={agents} userProfile={userProfile} />}
                    </article>
                  </div>
                ))}
                {activeCompletedRunSummary && !activeCompletedRunSummary.beforeMessageId && !isRunning && <CompletedRunStatus summary={activeCompletedRunSummary} />}
                {isRunning && (
                  <ChatRunStatus
                    target={runTarget || (activeComposerAgent ? { kind: 'agent', agent: activeComposerAgent } : null)}
                    startedAt={runStartedAt}
                    tick={runTick}
                    draft={runDraft}
                    error={runError}
                  />
                )}
                <div ref={threadBottomRef} />
                </div>
              </div>
              <ThreadOverviewRail rounds={overviewRounds} activeRoundId={activeOverviewRoundId} onJumpToRound={jumpToThreadRound} />
              <div className="composer-shell">
                {!isFollowingLatest && hasNewThreadContent && (
                  <button
                    className={isRunning ? 'thread-jump-latest is-running' : 'thread-jump-latest'}
                    type="button"
                    aria-label="回到最新消息"
                    onClick={() => scrollThreadToLatest('smooth')}
                  >
                    <ArrowDownToLine size={14} aria-hidden="true" />
                    <span>回到最新</span>
                    {isRunning && <span className="thread-jump-latest-dot" aria-hidden="true" />}
                  </button>
                )}
                {runClarification || runApproval ? (
                  <RunDecisionPanel
                    clarification={runClarification}
                    approval={runApproval}
                    submitting={runClarification ? clarificationSubmitting : approvalSubmitting}
                    error={runClarification ? clarificationError : approvalError}
                    onAnswer={(answer) => void respondToActiveClarification('answer', answer)}
                    onSkip={() => void respondToActiveClarification('skip')}
                    onApprove={(choice) => void approveActiveRun(choice)}
                  />
                ) : (
                  <div className="composer">
                  <MentionTextarea
                    value={input}
                    onChange={setInput}
                    onSend={() => void sendMessage()}
                    sendKey={uiSettings.sendKey || 'enter'}
                    agents={agents}
                    selectedAgentIds={selectedAgentIds}
                    placeholder="随意输入，随意@"
                  />
	                  <div className="composer-toolbar">
	                    <div className="composer-left-tools">
	                      <button className="icon-btn composer-tool upload" onClick={() => fileInputRef.current?.click()} aria-label="上传附件" title="上传附件"><Plus size={19} /></button>
	                      <input ref={fileInputRef} className="file-input" type="file" multiple onChange={(event) => handleAttachmentChange(event.target.files)} />
	                      <PermissionModeControl value={permissionMode} onChange={(mode) => void updateThreadPermissionMode(mode)} />
	                    </div>
	                    <div className="composer-right-tools">
	                      <ProviderModelPicker
	                        className="composer-model composer-agent-model"
	                        agentName={activeComposerAgent?.name || ''}
	                        value={activeComposerProfileModelValue}
	                        models={hermesProfileModelOptions}
	                        emptyLabel={profileModelLabel(activeComposerProfileName, localProfilesForComposer)}
	                        ariaLabel={activeComposerAgent ? `${activeComposerAgent.name} 的 Hermes Profile 模型` : 'Hermes Profile 模型'}
	                        title={activeComposerAgent ? `Profile：${activeComposerProfileName}` : 'Hermes Profile 模型'}
	                        allowDefault
	                        usingDefault={!activeThreadModelOverride}
	                        onChange={(value) => activeComposerAgent && void updateThreadAgentModelOverride(activeComposerAgent.id, value)}
	                      />
	                      <ComposerRunButton
	                        isRunning={isRunning}
	                        hasActiveRun={Boolean(activeHermesRun)}
	                        isStopping={runStopping}
	                        canSend={Boolean(input.trim())}
	                        onSend={() => void sendMessage()}
	                        onStop={() => void stopActiveRun()}
	                      />
	                    </div>
	                  </div>
	                  {attachments.length > 0 && (
	                    <div className="attachment-chips" aria-label="已选择附件">
	                      {attachments.map((file, index) => (
	                        <span className="attachment-chip" key={`${file.name}-${file.size}-${index}`}>
	                          <span>{file.name}</span>
	                          <small>{formatFileSize(file.size)}</small>
	                          <button onClick={() => removeAttachment(index)} aria-label={`移除 ${file.name}`}><X size={12} /></button>
	                        </span>
	                      ))}
	                    </div>
	                  )}
	                </div>
                )}
              </div>
            </section>
          </>
        )}
      </main>

      {rightRailKind && (
        <>
          <ResizeHandle
            side="right"
            disabled={!rightRailOpen}
            onResize={setContextWidth}
            onCommit={(width) => void persistUi({ contextWidth: width })}
          />
          <aside className="context">
            <CodexResourcePanel
            contextPacket={activeThread?.contextPacket || null}
            proposals={activeThread?.proposals || []}
            workspaceArtifacts={workspaceArtifacts}
            thread={activeThread}
            agents={agents}
            workspace={activeWorkspace}
            isRunning={isRunning}
            runTools={runTools}
            runApproval={runApproval}
            runClarification={runClarification}
            runError={runError}
            runDraft={runDraft}
            />
          </aside>
        </>
      )}

      {agentPickerOpen && (
        <div className="modal-backdrop" onClick={() => setAgentPickerOpen(false)}>
          <div className="modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><h2>团队成员</h2><p>@Agent 会自动加入当前 Workspace，也可以在这里手动管理成员。</p></div>
              <button className="icon-btn" onClick={() => setAgentPickerOpen(false)} aria-label="关闭"><X size={18} /></button>
            </div>
            <div className="agent-list">
              {agents.map((agent) => (
                <div
                  className={`agent-option ${agent.id === 'iris' ? 'locked' : ''}`}
                  key={agent.id}
                  onClick={() => void toggleAgent(agent.id)}
                  onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') void toggleAgent(agent.id); }}
                  role="button"
                  tabIndex={0}
                >
                  <AgentAvatar agent={agent} />
                  <span className="agent-option-main">
                    <strong>{agent.name}</strong>
                    <small>{agent.role}</small>
                    <em>默认模型：{agentDefaultModelLabel(agent, models)} · 本会话：{agentSessionModelLabel(agent, models, activeThread?.agentModelOverrides || {}, uiSettings.defaultModel)}</em>
                  </span>
                  <button
                    className="agent-row-icon"
                    onClick={(event) => {
                      event.stopPropagation();
                      setAgentModelEditorId(agent.id);
                    }}
                    aria-label={`编辑 ${agent.name} 本会话模型`}
                    title="编辑本会话模型"
                    type="button"
                  >
                    <Pencil size={15} />
                  </button>
                  <span className={selectedAgentIds.includes(agent.id) ? 'check on' : 'check'}><CheckCircle2 size={17} /></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {agentModelEditorId && activeThread && (
        <AgentSessionModelModal
          agent={agents.find((agent) => agent.id === agentModelEditorId) || null}
          models={models}
          value={agents.find((agent) => agent.id === agentModelEditorId) ? modelValueForAgent(agents.find((agent) => agent.id === agentModelEditorId)!, models, activeThread.agentModelOverrides || {}, uiSettings.defaultModel) : ''}
          onClose={() => setAgentModelEditorId(null)}
          onSave={async (agentId, modelId) => {
            await updateThreadAgentModelOverride(agentId, modelId);
            setAgentModelEditorId(null);
          }}
          onOpenModels={() => {
            setAgentModelEditorId(null);
            setAgentPickerOpen(false);
            setActiveView('thread');
            setActiveNav('models');
          }}
        />
      )}
      {projectModalOpen && (
        <div className="modal-backdrop" onClick={() => setProjectModalOpen(false)}>
          <div className="modal project-modal" onClick={(event) => event.stopPropagation()}>
            <div className="modal-head">
              <div><h2>{projectModalPurpose === 'convert' ? '转为项目' : '新建项目'}</h2><p>{projectModalPurpose === 'convert' ? '选择一个文件夹作为项目目录，当前对话会保存到这里。' : '选择一个文件夹作为项目目录，项目对话和产物会保存在这里。'}</p></div>
              <button className="icon-btn" onClick={() => setProjectModalOpen(false)} aria-label="关闭"><X size={18} /></button>
            </div>
            <div className="project-form">
              <div className="project-choice-grid">
                <button className={projectMode === 'create' ? 'selected' : ''} onClick={() => setProjectMode('create')}>
                  <span><Plus size={17} /></span>
                  <strong>创建新文件夹</strong>
                  <small>输入项目名后，Frakio Work 会在选定位置创建目录。</small>
                </button>
                <button className={projectMode === 'existing' ? 'selected' : ''} onClick={() => void chooseExistingProjectFolder()}>
                  <span><FolderOpen size={17} /></span>
                  <strong>选择已有文件夹</strong>
                  <small>直接选择你已经准备好的项目文件夹。</small>
                </button>
              </div>
              {projectMode === 'create' ? (
                <>
                  <label className="form-row">
                    <span>项目名称</span>
                    <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder={projectModalPurpose === 'convert' ? '留空则使用当前对话标题' : '例如 Frakio Blog Ops'} />
                  </label>
                  <div className="project-location-row">
                    <span>保存位置</span>
                    <button className="secondary-btn" onClick={() => void chooseProjectParentFolder()}><FolderOpen size={14} />选择位置</button>
                  </div>
                  <div className="project-path-preview">{projectParentPath || defaultProjectParentPath}</div>
                  {projectName.trim() && (
                    <div className="project-path-preview target">{projectParentPath || defaultProjectParentPath}/{slugText(projectName)}</div>
                  )}
                </>
              ) : (
                !canSelectFolder && (
                  <label className="form-row">
                    <span>已有文件夹路径</span>
                    <input value={projectRootPath} onChange={(event) => setProjectRootPath(event.target.value)} placeholder="/path/to/frakio-workspace" />
                  </label>
                )
              )}
              {projectError && <div className="form-error">{projectError}</div>}
              <div className="modal-actions">
                <button className="secondary-btn" onClick={() => setProjectModalOpen(false)}>取消</button>
                {projectMode === 'create' ? (
                  <button className="send-btn" onClick={() => projectModalPurpose === 'convert' ? void convertActiveConversationToProject() : void createWorkspaceProject()}>{projectModalPurpose === 'convert' ? '转为项目' : '创建项目'}</button>
                ) : !canSelectFolder ? (
                  <button className="send-btn" onClick={() => projectModalPurpose === 'convert' ? void convertActiveConversationToProject() : void createWorkspaceProject()}>选择项目</button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      )}
      {newAgentOpen && (
        <AgentEditorModal
          title="新建 Agent"
          models={models}
          agent={null}
          onClose={() => setNewAgentOpen(false)}
          onSave={createAgent}
        />
      )}
      {editingAgentId && (
        <AgentEditorModal
          title="Agent Profile"
          models={models}
          agent={agents.find((agent) => agent.id === editingAgentId) || null}
          onClose={() => setEditingAgentId(null)}
          onSave={async (payload) => {
            await updateAgent(editingAgentId, payload);
            setEditingAgentId(null);
          }}
        />
      )}
    </div>
    )}
    {showFirstUseGuide && (
      <FirstUseGuideOverlay
        guide={firstUseGuide}
        onClose={() => setShowFirstUseGuide(false)}
        onRetry={() => void runFirstUseGuide({ manual: true })}
        onInstall={() => void installHermesFromGuide()}
      />
    )}
    {showTelemetryNotice && !showFirstUseGuide && launchPhase === 'done' && (
      <TelemetryNotice
        onAllow={() => void answerTelemetryConsent(true)}
        onDecline={() => void answerTelemetryConsent(false)}
      />
    )}
    {launchPhase !== 'done' && (
      <LaunchLoadingScreen
        phase={launchPhase}
        agent={defaultLaunchAgent}
        userAvatarUrl={launchWelcomeAvatarUrl}
        autoStart={hermesRuntime?.autoStart || null}
      />
    )}
    </>
  );
}

async function requestJson<T>(url: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || data?.error?.message || '请求失败');
  return data as T;
}

const profileOptionFallback = [{ name: 'default', model: '', provider: '', hasConfig: true, hasEnv: false, hasAuth: false }];

function profileOptions(profiles: HermesProfile[]) {
  return profiles.length ? profiles : profileOptionFallback;
}

const settingsTabs = [
  { id: 'proxy', label: '代理' },
  { id: 'agent', label: '代理执行' },
  { id: 'gateway', label: 'Gateway' },
  { id: 'memory', label: '记忆' },
  { id: 'compression', label: '上下文压缩' },
  { id: 'session', label: '会话' },
  { id: 'voice', label: '语音' },
];

const settingFields: Record<string, Array<{ section: string; key: string; label: string; type: 'toggle' | 'number' | 'text' | 'select' | 'csv'; options?: string[]; placeholder?: string }>> = {
  proxy: [
    { section: 'proxy', key: 'HTTPS_PROXY', label: 'HTTPS_PROXY', type: 'text', placeholder: 'http://127.0.0.1:7890' },
    { section: 'proxy', key: 'HTTP_PROXY', label: 'HTTP_PROXY', type: 'text' },
    { section: 'proxy', key: 'ALL_PROXY', label: 'ALL_PROXY', type: 'text' },
    { section: 'proxy', key: 'NO_PROXY', label: 'NO_PROXY', type: 'text', placeholder: 'localhost,127.0.0.1' },
  ],
  agent: [
    { section: 'agent', key: 'max_turns', label: '最大轮次', type: 'number' },
    { section: 'agent', key: 'gateway_timeout', label: '网关超时（秒）', type: 'number' },
    { section: 'agent', key: 'restart_drain_timeout', label: '重启排空超时（秒）', type: 'number' },
    { section: 'agent', key: 'tool_use_enforcement', label: '工具执行策略', type: 'select', options: ['auto', 'strict', 'off'] },
  ],
  gateway: [
    { section: 'gatewayAutoStart', key: 'enabled', label: 'Gateway 自动启动', type: 'toggle' },
    { section: 'gatewayAutoStart', key: 'management', label: '统一 Gateway', type: 'select', options: ['per_profile', 'unified'] },
    { section: 'gatewayAutoStart', key: 'include', label: '白名单 profiles', type: 'csv', placeholder: 'default, reviewer' },
    { section: 'gatewayAutoStart', key: 'exclude', label: '排除 profiles', type: 'csv', placeholder: 'default, reviewer' },
  ],
  memory: [
    { section: 'memory', key: 'memory_enabled', label: '启用记忆', type: 'toggle' },
    { section: 'memory', key: 'user_profile_enabled', label: '用户画像', type: 'toggle' },
    { section: 'memory', key: 'memory_char_limit', label: '记忆字符上限', type: 'number' },
    { section: 'memory', key: 'user_char_limit', label: '用户画像字符上限', type: 'number' },
    { section: 'memory', key: 'write_approval', label: '记忆写入审核', type: 'toggle' },
    { section: 'skills', key: 'write_approval', label: '技能写入审核', type: 'toggle' },
  ],
  compression: [
    { section: 'compression', key: 'enabled', label: '启用压缩', type: 'toggle' },
    { section: 'compression', key: 'threshold', label: '压缩阈值', type: 'number' },
    { section: 'compression', key: 'target_ratio', label: '目标比例', type: 'number' },
    { section: 'compression', key: 'protect_last_n', label: '保护最近消息', type: 'number' },
    { section: 'compression', key: 'protect_first_n', label: '保护开头消息', type: 'number' },
  ],
  session: [
    { section: 'approvals', key: 'mode', label: '操作权限', type: 'select', options: ['manual', 'smart', 'off'] },
    { section: 'session_reset', key: 'mode', label: '重置模式', type: 'select', options: ['off', 'idle', 'scheduled', 'idle+scheduled'] },
    { section: 'session_reset', key: 'idle_minutes', label: '空闲超时（分钟）', type: 'number' },
    { section: 'session_reset', key: 'at_hour', label: '定时重置时间', type: 'number' },
  ],
  voice: [
    { section: 'tts', key: 'provider', label: '当前 TTS API', type: 'select', options: ['edge', 'openai', 'elevenlabs', 'mistral', 'xai', 'neutts', 'piper'] },
    { section: 'tts', key: 'edge.voice', label: 'Edge TTS 音色', type: 'text', placeholder: 'zh-CN-XiaoxiaoNeural' },
    { section: 'stt', key: 'provider', label: '当前 STT API', type: 'select', options: ['local', 'browser', 'openai', 'mistral', 'elevenlabs'] },
  ],
};

function HermesProfileConfigEditor({ profileName, compact = false }: { profileName: string; compact?: boolean }) {
  const [activeTab, setActiveTab] = useState('agent_run');
  const [config, setConfig] = useState<HermesConfig>({});
  const [draft, setDraft] = useState<HermesConfig>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');

  async function loadConfig(nextProfile = profileName) {
    if (!nextProfile) return;
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<HermesConfig>(`/api/hermes/config?profile=${encodeURIComponent(nextProfile)}`);
      setConfig(data);
      setDraft(data);
    } catch (err: any) {
      setError(err.message || '配置读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setActiveTab('agent_run');
    setConfig({});
    setDraft({});
    setError('');
    setSaving('');
    void loadConfig(profileName);
  }, [profileName]);

  function fieldValue(section: string, key: string) {
    return getNestedValue(draft?.[section] || {}, key) ?? '';
  }

  function updateField(section: string, key: string, value: any) {
    setDraft((current) => ({
      ...current,
      [section]: setNestedDraft(current[section] || {}, key, value),
    }));
  }

  async function saveSection(section: string) {
    if (!profileName) return;
    setSaving(section);
    setError('');
    try {
      await requestJson(`/api/hermes/config?profile=${encodeURIComponent(profileName)}`, {
        method: 'PUT',
        body: JSON.stringify({ section, values: draft[section] || {} }),
      });
      await loadConfig(profileName);
    } catch (err: any) {
      setError(err.message || '配置保存失败');
    } finally {
      setSaving('');
    }
  }

  const fields = settingFields[activeTab] || [];
  const sections = Array.from(new Set(fields.map((field) => field.section)));

  return (
    <section className={compact ? 'studio-settings-panel agent-config-editor compact' : 'studio-settings-panel agent-config-editor'}>
      <div className="studio-toolbar agent-config-toolbar">
        <div>
          <h3>Hermes Profile 配置</h3>
          <p>正在编辑：{profileName}</p>
        </div>
      </div>
      <div className="module-matrix-tabs">
        {settingsTabs.map((tab) => <button className={activeTab === tab.id ? 'selected' : ''} key={tab.id} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
      </div>
      {error && <div className="form-error">{error}</div>}
      {loading ? <div className="empty-state">读取 Hermes 配置中...</div> : (
        <div className="settings-option-list">
          {fields.map((field) => (
            <label className="settings-option-row" key={`${field.section}.${field.key}`}>
              <span><strong>{field.label}</strong><small>{field.section}.{field.key}</small></span>
              {field.type === 'toggle' ? (
                <input type="checkbox" checked={Boolean(fieldValue(field.section, field.key))} onChange={(event) => updateField(field.section, field.key, event.target.checked)} />
              ) : field.type === 'select' ? (
                <select value={String(fieldValue(field.section, field.key) || field.options?.[0] || '')} onChange={(event) => updateField(field.section, field.key, event.target.value)}>
                  {(field.options || []).map((option) => <option key={option} value={option}>{field.section === 'approvals' && field.key === 'mode' ? permissionLabel(option) : option}</option>)}
                </select>
              ) : (
                <input
                  type={field.type === 'number' ? 'number' : 'text'}
                  step={field.key.includes('ratio') || field.key.includes('threshold') ? '0.1' : '1'}
                  value={inputValue(fieldValue(field.section, field.key))}
                  placeholder={field.placeholder}
                  onChange={(event) => updateField(field.section, field.key, field.type === 'number' ? Number(event.target.value) : field.type === 'csv' ? csvValue(event.target.value) : event.target.value)}
                />
              )}
            </label>
          ))}
          <div className="settings-save-row">
            {sections.map((section) => (
              <button className="secondary-btn" key={section} onClick={() => void saveSection(section)} disabled={Boolean(saving)}>
                {saving === section ? '保存中' : `保存 ${section}`}
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

type PlatformField = { key: string; label: string; hint?: string; type?: 'toggle' | 'csv'; credential?: boolean; secret?: boolean; placeholder?: string };
type PlatformDefinition = { key: string; name: string; icon: React.ComponentType<{ size?: number }>; exclusive?: boolean; fields: PlatformField[] };
const exclusiveTokenHint = '此平台使用独占 token 锁。每个 profile 必须使用不同的身份 token，否则会与其他 profile 冲突导致 gateway 启动失败。';
const platformDefinitions: PlatformDefinition[] = [
  { key: 'telegram', name: 'Telegram', icon: Send, exclusive: true, fields: [{ key: 'token', label: 'Bot Token', hint: '开发者门户获取的 Bot Token', credential: true, placeholder: '123456:ABC-DEF...' }, { key: 'proxy', label: '代理 URL', hint: '可选的平台专用代理，支持 http://、https:// 和 socks5://', credential: true, placeholder: 'socks5://127.0.0.1:7890' }, { key: 'require_mention', label: '需要 @提及', hint: '群组中需要 @机器人 才会响应', type: 'toggle' }, { key: 'reactions', label: '表情回应', hint: '对消息添加表情回应', type: 'toggle' }, { key: 'free_response_chats', label: '自由响应聊天', hint: '不需要 @提及即响应的聊天 ID，逗号分隔', placeholder: 'chat_id1,chat_id2' }, { key: 'mention_patterns', label: '自定义提及模式', hint: '额外的触发模式列表', type: 'csv', placeholder: 'pattern1, pattern2' }] },
  { key: 'discord', name: 'Discord', icon: MessageSquare, exclusive: true, fields: [{ key: 'token', label: 'Bot Token', hint: 'Discord Bot Token', credential: true, placeholder: 'Bot token...' }, { key: 'proxy', label: '代理 URL', hint: '可选的平台专用代理', credential: true, placeholder: 'socks5://127.0.0.1:7890' }, { key: 'require_mention', label: '需要 @提及', hint: '频道中需要提及机器人', type: 'toggle' }, { key: 'auto_thread', label: '自动线程', hint: '自动把回复放入线程', type: 'toggle' }, { key: 'reactions', label: '表情回应', hint: '对消息添加表情回应', type: 'toggle' }, { key: 'free_response_channels', label: '自由响应频道', hint: '不需要提及即可响应的频道 ID', placeholder: 'channel_id1,channel_id2' }, { key: 'allowed_channels', label: '允许频道', hint: '限制可响应频道', placeholder: 'channel_id1,channel_id2' }, { key: 'ignored_channels', label: '忽略频道', hint: '忽略这些频道', placeholder: 'channel_id1,channel_id2' }, { key: 'no_thread_channels', label: '禁用线程频道', hint: '这些频道不自动开线程', placeholder: 'channel_id1,channel_id2' }] },
  { key: 'slack', name: 'Slack', icon: Network, exclusive: true, fields: [{ key: 'token', label: 'Bot Token', hint: 'Slack Bot Token', credential: true, placeholder: 'xoxb-...' }, { key: 'require_mention', label: '需要 @提及', hint: '频道中需要提及机器人', type: 'toggle' }, { key: 'allow_bots', label: '允许机器人消息', hint: '允许响应机器人消息', type: 'toggle' }, { key: 'free_response_channels', label: '自由响应频道', hint: '不需要提及即可响应的频道 ID', placeholder: 'channel_id1,channel_id2' }] },
  { key: 'whatsapp', name: 'WhatsApp', icon: MessageSquare, exclusive: true, fields: [{ key: 'enabled', label: '启用', hint: '启用 WhatsApp gateway', type: 'toggle', credential: true }, { key: 'require_mention', label: '需要 @提及', hint: '群组中需要提及机器人', type: 'toggle' }, { key: 'free_response_chats', label: '自由响应聊天', hint: '不需要提及即可响应的聊天 ID', placeholder: 'chat_id1,chat_id2' }, { key: 'mention_patterns', label: '自定义提及模式', hint: '额外触发模式列表', type: 'csv', placeholder: 'pattern1, pattern2' }] },
  { key: 'matrix', name: 'Matrix', icon: Boxes, fields: [{ key: 'token', label: 'Access Token', hint: 'Matrix access token', credential: true, placeholder: 'syt_...' }, { key: 'extra.homeserver', label: 'Homeserver', hint: 'Matrix homeserver 地址', credential: true, placeholder: 'https://matrix.org' }, { key: 'extra.user_id', label: 'User ID', hint: 'Matrix 用户 ID', credential: true, placeholder: '@hermes:example.org' }, { key: 'extra.password', label: 'Password', hint: '没有 token 时可使用密码登录', credential: true, secret: true, placeholder: 'Matrix password' }, { key: 'proxy', label: '代理 URL', hint: '可选的平台专用代理', credential: true, placeholder: 'socks5://127.0.0.1:7890' }, { key: 'require_mention', label: '需要 @提及', hint: '房间中需要提及机器人', type: 'toggle' }, { key: 'auto_thread', label: '自动线程', hint: '自动创建线程', type: 'toggle' }, { key: 'dm_mention_threads', label: '私信提及线程', hint: '私信提及时创建线程', type: 'toggle' }, { key: 'free_response_rooms', label: '自由响应房间', hint: '不需要提及即可响应的房间 ID', placeholder: 'room_id1,room_id2' }] },
  { key: 'feishu', name: 'Feishu', icon: FileText, exclusive: true, fields: [{ key: 'extra.app_id', label: 'App ID', hint: '飞书应用 App ID', credential: true, placeholder: 'cli_...' }, { key: 'extra.app_secret', label: 'App Secret', hint: '飞书应用密钥', credential: true, secret: true, placeholder: 'App Secret' }, { key: 'extra.encrypt_key', label: 'Encrypt Key', hint: '事件订阅加密密钥', credential: true, secret: true, placeholder: 'Encrypt Key' }, { key: 'extra.verification_token', label: 'Verification Token', hint: '事件订阅校验 token', credential: true, secret: true, placeholder: 'Verification Token' }, { key: 'require_mention', label: '需要 @提及', hint: '群聊中需要提及机器人', type: 'toggle' }, { key: 'free_response_chats', label: '自由响应聊天', hint: '不需要提及即可响应的聊天 ID', placeholder: 'chat_id1,chat_id2' }] },
  { key: 'dingtalk', name: 'DingTalk', icon: ZapIcon, exclusive: true, fields: [{ key: 'extra.client_id', label: 'Client ID', hint: '钉钉 Client ID', credential: true, placeholder: 'Client ID' }, { key: 'extra.client_secret', label: 'Client Secret', hint: '钉钉 Client Secret', credential: true, secret: true, placeholder: 'Client Secret' }, { key: 'extra.app_key', label: 'App Key', hint: '钉钉 App Key', credential: true, placeholder: 'App Key' }, { key: 'extra.card_template_id', label: 'AI Card Template ID', hint: 'AI 卡片模板 ID', credential: true, placeholder: 'AI Card Template ID' }, { key: 'allow_all_users', label: '允许所有用户', hint: '允许所有用户触发机器人', type: 'toggle', credential: true }, { key: 'allowed_users', label: '允许用户', hint: '允许的用户 ID，逗号分隔', credential: true, placeholder: 'user_id1,user_id2' }, { key: 'require_mention', label: '需要 @提及', hint: '群聊中需要提及机器人', type: 'toggle' }, { key: 'free_response_chats', label: '自由响应聊天', hint: '不需要提及即可响应的聊天 ID', placeholder: 'chat_id1,chat_id2' }] },
  { key: 'qqbot', name: 'QQBot', icon: Bot, exclusive: true, fields: [{ key: 'extra.app_id', label: 'App ID', hint: 'QQ Bot App ID', credential: true, placeholder: 'App ID' }, { key: 'extra.client_secret', label: 'App Secret', hint: 'QQ Bot App Secret', credential: true, secret: true, placeholder: 'App Secret' }, { key: 'allowed_users', label: '允许用户', hint: '允许的 openid，逗号分隔', credential: true, placeholder: 'openid1,openid2' }, { key: 'allow_all_users', label: '允许所有用户', hint: '允许所有用户触发机器人', type: 'toggle', credential: true }, { key: 'extra.markdown_support', label: 'Markdown 支持', hint: '启用 QQ markdown 消息', type: 'toggle' }] },
  { key: 'weixin', name: 'Weixin', icon: MessageSquare, exclusive: true, fields: [{ key: 'token', label: 'Token', hint: '微信 iLink bot token', credential: true, secret: true, placeholder: 'Token' }, { key: 'extra.account_id', label: 'Account ID', hint: '微信 iLink bot account ID', credential: true, placeholder: 'Account ID' }, { key: 'extra.base_url', label: 'Base URL', hint: 'iLink API base URL', credential: true, placeholder: 'https://ilinkai.weixin.qq.com' }] },
  { key: 'wecom', name: 'WeCom', icon: Building2, fields: [{ key: 'extra.bot_id', label: 'Bot ID', hint: '企业微信 Bot ID', credential: true, placeholder: 'Bot ID' }, { key: 'extra.secret', label: 'Secret', hint: '企业微信 Secret', credential: true, secret: true, placeholder: 'Secret' }] },
];

function getNestedValue(source: Record<string, any>, keyPath: string) {
  return keyPath.split('.').reduce((value, key) => value?.[key], source);
}

function inputValue(value: unknown) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return '';
  return String(value);
}

function csvValue(value: string) {
  return value.split(',').map((item) => item.trim()).filter(Boolean);
}

function setNestedDraft(source: Record<string, any>, keyPath: string, value: any) {
  const next = JSON.parse(JSON.stringify(source || {}));
  const parts = keyPath.split('.');
  let cursor = next;
  for (let index = 0; index < parts.length - 1; index += 1) {
    cursor[parts[index]] = cursor[parts[index]] || {};
    cursor = cursor[parts[index]];
  }
  cursor[parts[parts.length - 1]] = value;
  return next;
}

function cloneRecord<T>(value: T): T {
  return JSON.parse(JSON.stringify(value || {}));
}

function sameJson(a: unknown, b: unknown) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

function pickPlatformValues(current: Record<string, any>, fields: PlatformField[]) {
  return fields
    .reduce((values, field) => {
      const value = getNestedValue(current, field.key);
      if (value !== undefined) return setNestedDraft(values, field.key, value);
      return values;
    }, {} as Record<string, any>);
}

function platformConfigured(platform: PlatformDefinition, credentials: Record<string, any>) {
  if (platform.key === 'matrix') {
    const extra = credentials.extra || {};
    const homeserver = String(extra.homeserver || '').trim();
    const token = String(credentials.token || '').trim();
    const userId = String(extra.user_id || '').trim();
    const password = String(extra.password || '').trim();
    return Boolean(homeserver && (token || (userId && password)));
  }
  const keys = ['token', 'api_key', 'app_id', 'client_id', 'secret', 'app_secret', 'client_secret', 'access_token', 'bot_id', 'account_id', 'enabled'];
  const targets = [credentials, credentials.extra].filter(Boolean);
  return targets.some((target) => keys.some((key) => {
    const value = target[key];
    return value !== undefined && value !== null && value !== '' && value !== false;
  }));
}

function qrStatusLabel(status: WeixinQrStatus['status']) {
  if (status === 'loading') return '正在获取二维码...';
  if (status === 'waiting') return '二维码已打开，请使用微信扫码登录。';
  if (status === 'scaned') return '已扫码，请在微信中确认登录。';
  if (status === 'expired') return '二维码已过期，请重新登录。';
  if (status === 'confirmed') return '已确认，正在保存凭据。';
  if (status === 'error') return '扫码登录失败。';
  return '';
}

type WeixinQrStatus = { status: 'idle' | 'loading' | 'waiting' | 'scaned' | 'scaned_but_redirect' | 'expired' | 'confirmed' | 'error'; qrcode?: string; error?: string };

function ChannelsPage({ profiles, defaultProfile, embedded = false }: { profiles: HermesProfile[]; defaultProfile: string; embedded?: boolean }) {
  const [profile, setProfile] = useState(defaultProfile || 'default');
  const [config, setConfig] = useState<HermesConfig>({});
  const [configDrafts, setConfigDrafts] = useState<Record<string, Record<string, any>>>({});
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, Record<string, any>>>({});
  const [expandedPlatforms, setExpandedPlatforms] = useState<Record<string, boolean>>({});
  const [touchedConfig, setTouchedConfig] = useState<Record<string, boolean>>({});
  const [touchedCredentials, setTouchedCredentials] = useState<Record<string, boolean>>({});
  const [weixinQr, setWeixinQr] = useState<WeixinQrStatus>({ status: 'idle' });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState('');
  const [error, setError] = useState('');
  const weixinPollRef = useRef<number | null>(null);

  async function loadChannels(nextProfile = profile) {
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<HermesConfig>(`/api/hermes/config?profile=${encodeURIComponent(nextProfile)}`);
      setConfig(data);
      setConfigDrafts(Object.fromEntries(platformDefinitions.map((platform) => [platform.key, pickPlatformValues(data.platforms?.[platform.key] || {}, platform.fields.filter((field) => !field.credential))])));
      setCredentialDrafts(Object.fromEntries(platformDefinitions.map((platform) => [platform.key, pickPlatformValues(data.platforms?.[platform.key] || {}, platform.fields.filter((field) => field.credential))])));
      setTouchedConfig({});
      setTouchedCredentials({});
      setExpandedPlatforms((current) => Object.keys(current).length ? current : Object.fromEntries(platformDefinitions.map((platform) => [platform.key, true])));
    } catch (err: any) {
      setError(err.message || '频道配置读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadChannels(profile);
  }, [profile]);

  useEffect(() => () => {
    if (weixinPollRef.current) window.clearTimeout(weixinPollRef.current);
  }, []);

  function updateConfigDraft(platform: string, field: PlatformField, value: any) {
    setConfigDrafts((items) => ({ ...items, [platform]: setNestedDraft(items[platform] || {}, field.key, value) }));
    setTouchedConfig((items) => ({ ...items, [platform]: true }));
  }

  function updateCredentialDraft(platform: string, field: PlatformField, value: any) {
    setCredentialDrafts((items) => ({ ...items, [platform]: setNestedDraft(items[platform] || {}, field.key, value) }));
    setTouchedCredentials((items) => ({ ...items, [platform]: true }));
  }

  function hasConfigChanges(platform: PlatformDefinition) {
    const original = pickPlatformValues(config.platforms?.[platform.key] || {}, platform.fields.filter((field) => !field.credential));
    return Boolean(touchedConfig[platform.key]) && !sameJson(configDrafts[platform.key], original);
  }

  function hasCredentialChanges(platform: PlatformDefinition) {
    const original = pickPlatformValues(config.platforms?.[platform.key] || {}, platform.fields.filter((field) => field.credential));
    return Boolean(touchedCredentials[platform.key]) && !sameJson(credentialDrafts[platform.key], original);
  }

  async function savePlatform(platform: string) {
    setSaving(platform);
    setError('');
    try {
      const definition = platformDefinitions.find((item) => item.key === platform);
      if (!definition) return;
      if (hasConfigChanges(definition)) {
        await requestJson(`/api/hermes/config?profile=${encodeURIComponent(profile)}`, {
          method: 'PUT',
          body: JSON.stringify({ section: platform, values: cloneRecord(configDrafts[platform] || {}) }),
        });
      }
      if (hasCredentialChanges(definition)) {
        await requestJson(`/api/hermes/config/credentials?profile=${encodeURIComponent(profile)}`, {
          method: 'PUT',
          body: JSON.stringify({ platform, values: cloneRecord(credentialDrafts[platform] || {}) }),
        });
      }
      await loadChannels(profile);
    } catch (err: any) {
      setError(err.message || '频道配置保存失败');
    } finally {
      setSaving('');
    }
  }

  async function pollWeixinStatus(qrcode: string) {
    try {
      const data = await requestJson<{ status: WeixinQrStatus['status']; account_id?: string; token?: string; base_url?: string }>(`/api/hermes/weixin/qrcode/status?qrcode=${encodeURIComponent(qrcode)}`);
      if (data.status === 'confirmed' && data.account_id && data.token) {
        setWeixinQr({ status: 'confirmed', qrcode });
        await requestJson(`/api/hermes/weixin/save?profile=${encodeURIComponent(profile)}`, {
          method: 'POST',
          body: JSON.stringify({ account_id: data.account_id, token: data.token, base_url: data.base_url }),
        });
        await loadChannels(profile);
        setWeixinQr({ status: 'idle' });
        return;
      }
      if (data.status === 'expired') {
        setWeixinQr({ status: 'expired', qrcode });
        return;
      }
      setWeixinQr({ status: data.status === 'scaned_but_redirect' ? 'scaned' : data.status, qrcode });
      weixinPollRef.current = window.setTimeout(() => void pollWeixinStatus(qrcode), 3000);
    } catch (err: any) {
      setWeixinQr({ status: 'error', qrcode, error: err.message || '微信扫码状态读取失败' });
    }
  }

  async function startWeixinQrLogin() {
    if (weixinPollRef.current) window.clearTimeout(weixinPollRef.current);
    setWeixinQr({ status: 'loading' });
    setError('');
    try {
      const data = await requestJson<{ qrcode: string; qrcode_url: string }>('/api/hermes/weixin/qrcode');
      if (data.qrcode_url) window.open(data.qrcode_url, '_blank', 'noopener,noreferrer');
      setWeixinQr({ status: 'waiting', qrcode: data.qrcode });
      void pollWeixinStatus(data.qrcode);
    } catch (err: any) {
      setWeixinQr({ status: 'error', error: err.message || '微信二维码获取失败' });
    }
  }

  return (
    <section className={embedded ? 'embedded-management-page channels-page' : 'management-page channels-page'}>
      <div className="studio-toolbar settings-head">
        <div><h2>频道</h2></div>
        <label>Profile<select value={profile} onChange={(event) => setProfile(event.target.value)}>{profileOptions(profiles).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      {loading ? <div className="empty-state">读取频道配置中...</div> : (
        <div className="platform-grid">
          {platformDefinitions.map((platform) => {
            const Icon = platform.icon;
            const configDraft = configDrafts[platform.key] || {};
            const credentialDraft = credentialDrafts[platform.key] || {};
            const configured = platformConfigured(platform, credentialDraft);
            const expanded = expandedPlatforms[platform.key] !== false;
            const hasChanges = hasConfigChanges(platform) || hasCredentialChanges(platform);
            return (
              <article className={configured ? 'platform-card configured' : 'platform-card'} key={platform.key}>
                <button className="platform-head" onClick={() => setExpandedPlatforms((items) => ({ ...items, [platform.key]: !expanded }))} aria-expanded={expanded}>
                  <span className="platform-title"><span className="platform-icon"><Icon size={16} /></span><strong>{platform.name}</strong><em className={configured ? 'configured' : ''}>{configured ? '已配置' : '未配置'}</em>{platform.exclusive && <small>独占 token</small>}</span>
                  <ChevronDown size={16} />
                </button>
                {expanded && (
                  <div className="platform-body">
                    {platform.exclusive && <div className="platform-warning"><ShieldAlert size={15} />{exclusiveTokenHint}</div>}
                    {platform.key === 'weixin' && (
                      <div className="weixin-qr-section">
                        <button className="secondary-btn" onClick={() => void startWeixinQrLogin()} disabled={weixinQr.status === 'loading' || weixinQr.status === 'waiting' || weixinQr.status === 'scaned'}>
                          {configured ? '重新扫码登录' : '扫码登录'}
                        </button>
                        {weixinQr.status !== 'idle' && <span className={weixinQr.status === 'error' || weixinQr.status === 'expired' ? 'error' : ''}>{weixinQr.error || qrStatusLabel(weixinQr.status)}</span>}
                      </div>
                    )}
                    <div className="platform-fields">
                      {platform.fields.map((field) => {
                        const draft = field.credential ? credentialDraft : configDraft;
                        const value = getNestedValue(draft, field.key);
                        const update = field.credential ? updateCredentialDraft : updateConfigDraft;
                        return (
                          <label className="platform-setting-row" key={field.key}>
                            <span><strong>{field.label}</strong>{field.hint && <small>{field.hint}</small>}</span>
                            {field.type === 'toggle' ? (
                              <button className={Boolean(value) ? 'toggle-switch on' : 'toggle-switch'} type="button" onClick={() => update(platform.key, field, !Boolean(value))} aria-pressed={Boolean(value)}><i /></button>
                            ) : (
                              <input type={field.secret ? 'password' : 'text'} value={inputValue(value)} onChange={(event) => update(platform.key, field, field.type === 'csv' ? csvValue(event.target.value) : event.target.value)} placeholder={field.placeholder || field.label} />
                            )}
                          </label>
                        );
                      })}
                    </div>
                    <div className="platform-actions">
                      <button className="send-btn" onClick={() => void savePlatform(platform.key)} disabled={saving === platform.key || !hasChanges}>{saving === platform.key ? '保存中' : '保存'}</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

const emptyMcpForm: McpFormState = { name: '', transport: 'stdio', command: '', argsText: '', envText: '', url: '', headersText: '', auth: '', enabled: true };

function textFromRecord(record?: Record<string, string>) {
  return Object.entries(record || {}).map(([key, value]) => `${key}=${value}`).join('\n');
}

function mcpFormFromServer(server: McpServer): McpFormState {
  return {
    name: server.name,
    transport: server.transport || (server.url ? 'http' : 'stdio'),
    command: server.command || '',
    argsText: (server.args || []).join('\n'),
    envText: textFromRecord(server.env),
    url: server.url || '',
    headersText: textFromRecord(server.headers),
    auth: server.auth || '',
    enabled: server.enabled !== false,
  };
}

function mcpPayloadFromForm(form: McpFormState) {
  return {
    name: form.name.trim(),
    transport: form.transport,
    command: form.command.trim(),
    args: form.argsText.split('\n').map((item) => item.trim()).filter(Boolean),
    env: form.envText,
    url: form.url.trim(),
    headers: form.headersText,
    auth: form.auth.trim(),
    enabled: form.enabled,
  };
}

function McpSettingsPage({ profiles, defaultProfile }: { profiles: HermesProfile[]; defaultProfile: string }) {
  const [profile, setProfile] = useState(defaultProfile || 'default');
  const [payload, setPayload] = useState<McpServersPayload | null>(null);
  const [query, setQuery] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editingName, setEditingName] = useState('');
  const [form, setForm] = useState<McpFormState>(emptyMcpForm);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [installingWorkbench, setInstallingWorkbench] = useState(false);
  const [testing, setTesting] = useState('');
  const [error, setError] = useState('');
  const [testResult, setTestResult] = useState<Record<string, string>>({});

  async function loadServers(nextProfile = profile) {
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<McpServersPayload>(`/api/hermes/mcp/servers?profile=${encodeURIComponent(nextProfile)}`);
      setPayload(data);
    } catch (err: any) {
      setError(err.message || 'MCP 服务器读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadServers(profile);
  }, [profile]);

  function startCreate() {
    setEditingName('');
    setForm(emptyMcpForm);
    setFormOpen(true);
  }

  function startEdit(server: McpServer) {
    setEditingName(server.name);
    setForm(mcpFormFromServer(server));
    setFormOpen(true);
  }

  async function saveServer() {
    setSaving(true);
    setError('');
    try {
      const body = mcpPayloadFromForm(form);
      const url = editingName
        ? `/api/hermes/mcp/servers/${encodeURIComponent(editingName)}?profile=${encodeURIComponent(profile)}`
        : `/api/hermes/mcp/servers?profile=${encodeURIComponent(profile)}`;
      const data = await requestJson<McpServersPayload>(url, { method: editingName ? 'PATCH' : 'POST', body: JSON.stringify(editingName ? { config: body } : body) });
      setPayload(data);
      setFormOpen(false);
      setEditingName('');
      setForm(emptyMcpForm);
    } catch (err: any) {
      setError(err.message || 'MCP 服务器保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function toggleServer(server: McpServer) {
    const data = await requestJson<McpServersPayload>(`/api/hermes/mcp/servers/${encodeURIComponent(server.name)}?profile=${encodeURIComponent(profile)}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: !server.enabled }),
    });
    setPayload(data);
  }

  async function deleteServer(server: McpServer) {
    if (!window.confirm(`删除 MCP Server「${server.name}」？`)) return;
    const data = await requestJson<McpServersPayload>(`/api/hermes/mcp/servers/${encodeURIComponent(server.name)}?profile=${encodeURIComponent(profile)}`, { method: 'DELETE' });
    setPayload(data);
  }

  async function testServer(server: McpServer) {
    setTesting(server.name);
    setTestResult((current) => ({ ...current, [server.name]: '' }));
    try {
      const data = await requestJson<{ ok: boolean; tools?: string[]; output?: string }>(`/api/hermes/mcp/servers/${encodeURIComponent(server.name)}/test?profile=${encodeURIComponent(profile)}`, { method: 'POST' });
      setTestResult((current) => ({ ...current, [server.name]: `连接成功 · ${(data.tools || []).length} 个工具` }));
    } catch (err: any) {
      setTestResult((current) => ({ ...current, [server.name]: err.message || '测试失败' }));
    } finally {
      setTesting('');
    }
  }

  async function reloadMcp() {
    try {
      const data = await requestJson<{ runtime?: McpServersPayload; error?: string }>(`/api/hermes/mcp/reload?profile=${encodeURIComponent(profile)}`, { method: 'POST' });
      if (data.runtime) setPayload(data.runtime);
      if (data.error) setError(data.error);
    } catch (err: any) {
      setError(err.message || 'MCP 重载失败');
    }
  }

  async function installWorkbenchMcp() {
    setInstallingWorkbench(true);
    setError('');
    try {
      const data = await requestJson<McpServersPayload>(`/api/hermes/mcp/workbench/install?profile=${encodeURIComponent(profile)}`, { method: 'POST' });
      setPayload(data);
      setTestResult((current) => ({ ...current, 'hermes-workbench-api': '已安装 Frakio Work 内置 MCP', 'hermes-workbench-use': '已安装 Frakio Work 内置 MCP' }));
    } catch (err: any) {
      setError(err.message || 'Frakio Work 内置 MCP 安装失败');
    } finally {
      setInstallingWorkbench(false);
    }
  }

  const stats = payload?.stats || { total: 0, connected: 0, disconnected: 0, tools: 0 };
  const normalizedQuery = query.trim().toLowerCase();
  const servers = (payload?.servers || []).filter((server) => {
    const haystack = [server.name, server.command, server.url, server.statusLabel, ...(server.tools || [])].join(' ').toLowerCase();
    return !normalizedQuery || haystack.includes(normalizedQuery);
  });

  return (
    <section className="embedded-management-page mcp-page">
      <div className="studio-toolbar settings-head">
        <div><h2>MCP 服务器</h2></div>
        <div className="mcp-toolbar-actions">
          <label>Profile<select value={profile} onChange={(event) => setProfile(event.target.value)}>{profileOptions(profiles).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
          <button className="secondary-btn" onClick={() => void loadServers(profile)} disabled={loading}><RefreshCw size={15} />刷新</button>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="plugin-stats mcp-stats">
        <article><span>总计</span><strong>{stats.total}</strong><small>配置的服务器</small></article>
        <article><span>已连接</span><strong>{stats.connected}</strong><small>可识别工具</small></article>
        <article><span>未连接</span><strong>{stats.disconnected}</strong><small>停用或待重载</small></article>
        <article><span>工具</span><strong>{stats.tools}</strong><small>当前可展示工具</small></article>
      </div>
      <div className="plugin-toolbar">
        <label className="plugin-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索服务器或工具" />
        </label>
        <div className="mcp-toolbar-actions">
          <button className="secondary-btn" onClick={() => void installWorkbenchMcp()} disabled={installingWorkbench}>{installingWorkbench ? '安装中' : '安装 Frakio Work 内置 MCP'}</button>
          <button className="secondary-btn" onClick={() => void reloadMcp()}>全部重载</button>
          <button className="send-btn" onClick={startCreate}><Plus size={15} />添加服务器</button>
        </div>
      </div>
      {formOpen && (
        <div className="mcp-form">
          <label>名称<input value={form.name} disabled={Boolean(editingName)} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="agentmail" /></label>
          <label>类型<select value={form.transport} onChange={(event) => setForm({ ...form, transport: event.target.value as 'stdio' | 'http' })}><option value="stdio">stdio</option><option value="http">HTTP</option></select></label>
          {form.transport === 'stdio' ? <>
            <label>Command<input value={form.command} onChange={(event) => setForm({ ...form, command: event.target.value })} placeholder="npx" /></label>
            <label className="wide">Args<textarea value={form.argsText} onChange={(event) => setForm({ ...form, argsText: event.target.value })} placeholder="-y&#10;agentmail-mcp" /></label>
            <label className="wide">Env<textarea value={form.envText} onChange={(event) => setForm({ ...form, envText: event.target.value })} placeholder="API_KEY=..." /></label>
          </> : <>
            <label className="wide">URL<input value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} placeholder="https://example.com/mcp" /></label>
            <label className="wide">Headers<textarea value={form.headersText} onChange={(event) => setForm({ ...form, headersText: event.target.value })} placeholder="Authorization=Bearer ..." /></label>
            <label>Auth<input value={form.auth} onChange={(event) => setForm({ ...form, auth: event.target.value })} placeholder="oauth" /></label>
          </>}
          <label className="mcp-check"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} />启用</label>
          <div className="mcp-form-actions">
            <button className="secondary-btn" onClick={() => { setFormOpen(false); setEditingName(''); }}>取消</button>
            <button className="send-btn" onClick={() => void saveServer()} disabled={saving}>{saving ? '保存中' : '保存'}</button>
          </div>
        </div>
      )}
      {loading ? <div className="empty-state">读取 MCP 服务器中...</div> : servers.length ? (
        <div className="mcp-grid">
          {servers.map((server) => (
            <article className="mcp-card" key={server.name}>
              <div className="plugin-card-head">
                <div>
                  <strong>{server.name}</strong>
                  <span>{server.transport} · {server.command || server.url || '未配置入口'}</span>
                </div>
                <em className={server.enabled && server.status === 'connected' ? 'enabled' : ''}>{server.statusLabel}</em>
              </div>
              <div className="mcp-card-tools">
                <span>工具列表</span>
                <strong>{server.availableToolCount || server.toolCount}/{server.toolCount} 个工具</strong>
              </div>
              <div className="plugin-tags mcp-tools">
                {(server.tools || []).slice(0, 18).map((tool) => <span key={tool}>{tool}</span>)}
                {!server.tools?.length && <span>暂无工具列表</span>}
              </div>
              {(server.error || testResult[server.name]) && <p className="mcp-result">{testResult[server.name] || server.error}</p>}
              <div className="mcp-card-actions">
                <button onClick={() => startEdit(server)}>编辑</button>
                <button onClick={() => void testServer(server)} disabled={testing === server.name}>{testing === server.name ? '测试中' : '测试'}</button>
                <button onClick={() => void reloadMcp()}>重载</button>
                <button className="danger" onClick={() => void deleteServer(server)}>移除</button>
                <label className="mcp-switch"><input type="checkbox" checked={server.enabled} onChange={() => void toggleServer(server)} /><span /></label>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="empty-state">暂无 MCP Server。</div>}
    </section>
  );
}

function JobsPage({ profiles, defaultProfile, embedded = false }: { profiles: HermesProfile[]; defaultProfile: string; embedded?: boolean }) {
  const [profile, setProfile] = useState(defaultProfile || 'default');
  const [jobs, setJobs] = useState<HermesJob[]>([]);
  const [form, setForm] = useState({ name: '', schedule: '', prompt: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function loadJobs(nextProfile = profile) {
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<{ jobs: HermesJob[] }>(`/api/hermes/jobs?include_disabled=true&profile=${encodeURIComponent(nextProfile)}`);
      setJobs(data.jobs || []);
    } catch (err: any) {
      setError(err.message || '定时任务读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadJobs(profile);
  }, [profile]);

  async function createJob() {
    if (!form.schedule.trim()) return;
    await requestJson(`/api/hermes/jobs?profile=${encodeURIComponent(profile)}`, { method: 'POST', body: JSON.stringify(form) });
    setForm({ name: '', schedule: '', prompt: '' });
    await loadJobs(profile);
  }

  async function jobAction(job: HermesJob, action: 'run' | 'pause' | 'resume' | 'delete') {
    const method = action === 'delete' ? 'DELETE' : 'POST';
    const suffix = action === 'delete' ? '' : `/${action}`;
    await requestJson(`/api/hermes/jobs/${encodeURIComponent(job.job_id || job.id)}${suffix}?profile=${encodeURIComponent(profile)}`, { method });
    await loadJobs(profile);
  }

  const runHistory = jobs.filter((job) => job.last_run_at || job.last_status || job.last_error);

  return (
    <section className={embedded ? 'embedded-management-page' : 'management-page'}>
      <div className="studio-toolbar settings-head">
        <div><h2>定时任务</h2></div>
        <label>Profile<select value={profile} onChange={(event) => setProfile(event.target.value)}>{profileOptions(profiles).map((item) => <option key={item.name} value={item.name}>{item.name}</option>)}</select></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="create-strip">
        <input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="任务名称" />
        <input value={form.schedule} onChange={(event) => setForm({ ...form, schedule: event.target.value })} placeholder="30m / every 2h / 0 9 * * *" />
        <input value={form.prompt} onChange={(event) => setForm({ ...form, prompt: event.target.value })} placeholder="执行提示词" />
        <button className="send-btn" onClick={() => void createJob()}>创建任务</button>
      </div>
      {loading ? <div className="empty-state">读取定时任务中...</div> : jobs.length ? (
        <div className="job-list">
          {jobs.map((job) => (
            <article className="job-card" key={job.job_id || job.id}>
              <div><strong>{job.name}</strong><span>{job.schedule_display || '未设置时间'} · {job.state}</span><p>{job.prompt_preview || job.prompt || '无提示词'}</p></div>
              <div className="job-actions">
                <button className="secondary-btn" onClick={() => void jobAction(job, 'run')}>运行</button>
                <button className="secondary-btn" onClick={() => void jobAction(job, job.enabled ? 'pause' : 'resume')}>{job.enabled ? '暂停' : '恢复'}</button>
                <button className="secondary-btn danger" onClick={() => void jobAction(job, 'delete')}>删除</button>
              </div>
            </article>
          ))}
        </div>
      ) : <div className="empty-state">暂无定时任务。</div>}
      <section className="job-history-panel">
        <h3>运行历史</h3>
        {runHistory.length ? runHistory.map((job) => (
          <article className="job-history-row" key={`${job.job_id || job.id}-history`}>
            <strong>{job.name}</strong>
            <span>{job.last_status || 'unknown'} · {job.last_run_at || '未记录时间'}</span>
            {job.last_error && <p>{job.last_error}</p>}
          </article>
        )) : <div className="empty-state">暂无运行历史。</div>}
      </section>
    </section>
  );
}

const kanbanStatusLabels: Record<KanbanTaskStatus, string> = {
  triage: '待分拣',
  todo: '待办',
  scheduled: '已调度',
  ready: '就绪',
  running: '进行中',
  blocked: '阻塞',
  review: '待审查',
  done: '已完成',
  archived: '已归档',
};
const kanbanStatusOrder = Object.keys(kanbanStatusLabels) as KanbanTaskStatus[];

function KanbanPage({ agents }: { agents: Agent[] }) {
  const [boards, setBoards] = useState<KanbanBoard[]>([]);
  const [board, setBoard] = useState('default');
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [boardForm, setBoardForm] = useState({ slug: '', name: '' });
  const [stats, setStats] = useState<Record<string, any>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [boardMenuOpen, setBoardMenuOpen] = useState(false);
  const [boardComposerOpen, setBoardComposerOpen] = useState(false);
  const boardMenuRef = useRef<HTMLDivElement | null>(null);

  async function loadBoards() {
    try {
      const data = await requestJson<{ boards: KanbanBoard[] }>('/api/hermes/kanban/boards');
      setBoards(data.boards?.length ? data.boards : [{ slug: 'default', name: 'Default', total: 0 }]);
    } catch (err: any) {
      setError(err.message || '看板读取失败');
    }
  }

  async function loadTasks(nextBoard = board) {
    setLoading(true);
    setError('');
    try {
      const [taskData, statsData] = await Promise.all([
        requestJson<{ tasks: KanbanTask[] }>(`/api/hermes/kanban/tasks?board=${encodeURIComponent(nextBoard)}&includeArchived=true`),
        requestJson<{ stats: Record<string, any> }>(`/api/hermes/kanban/stats?board=${encodeURIComponent(nextBoard)}`),
      ]);
      const data = taskData;
      setTasks(data.tasks || []);
      setStats(statsData.stats || {});
    } catch (err: any) {
      setError(err.message || '任务读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadBoards();
  }, []);

  useEffect(() => {
    void loadTasks(board);
  }, [board]);

  useEffect(() => {
    if (!boardMenuOpen) return undefined;
    function handlePointerDown(event: PointerEvent) {
      if (boardMenuRef.current && !boardMenuRef.current.contains(event.target as Node)) setBoardMenuOpen(false);
    }
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [boardMenuOpen]);

  async function createBoard() {
    if (!boardForm.slug.trim()) return;
    await requestJson('/api/hermes/kanban/boards', { method: 'POST', body: JSON.stringify(boardForm) });
    setBoard(boardForm.slug.trim());
    setBoardForm({ slug: '', name: '' });
    setBoardMenuOpen(false);
    setBoardComposerOpen(false);
    await loadBoards();
  }

  async function setTaskStatus(task: KanbanTask, status: KanbanTaskStatus) {
    await requestJson(`/api/hermes/kanban/tasks/${encodeURIComponent(task.id)}?board=${encodeURIComponent(board)}`, { method: 'PATCH', body: JSON.stringify({ board, status }) });
    await Promise.all([loadBoards(), loadTasks(board)]);
  }

  const grouped = Object.fromEntries(kanbanStatusOrder.map((status) => [status, tasks.filter((task) => task.status === status)])) as Record<KanbanTaskStatus, KanbanTask[]>;
  const currentBoard = boards.find((item) => item.slug === board) || { slug: board, name: board === 'default' ? 'Default' : board, total: tasks.length };
  const boardTitle = currentBoard.name || currentBoard.slug;
  const visibleStatuses = kanbanStatusOrder.filter((status) => status !== 'archived' || grouped.archived.length > 0);
  const activeTaskCount = tasks.filter((task) => task.status !== 'archived').length;
  const statsEntries = kanbanStatusOrder
    .map((status) => ({ status, count: Number(stats.by_status?.[status] ?? grouped[status].length) }))
    .filter((item) => item.count > 0);

  return (
    <section className="management-page kanban-page">
      <div className="kanban-hero">
        <div className="kanban-title-stack">
          <span className="kanban-kicker">Hermes Kanban</span>
          <h2>{boardTitle}</h2>
        </div>
        <div className="kanban-top-actions">
          <div className="board-switcher" ref={boardMenuRef}>
            <button className="notion-btn" onClick={() => setBoardMenuOpen((open) => !open)} aria-expanded={boardMenuOpen}>
              <Boxes size={15} /> 看板 <ChevronDown size={14} />
            </button>
            {boardMenuOpen && (
              <div className="board-popover">
                <div className="board-popover-head">
                  <strong>所有看板</strong>
                  <span>{boards.length} 个</span>
                </div>
                <div className="board-list">
                  {boards.map((item) => {
                    const selected = item.slug === board;
                    return (
                      <button className={selected ? 'selected' : ''} key={item.slug} onClick={() => { setBoard(item.slug); setBoardMenuOpen(false); }}>
                        <span><Circle size={9} fill={selected ? 'currentColor' : 'none'} />{item.name || item.slug}</span>
                        <em>{item.total || 0}</em>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
          <button className="send-btn kanban-new-board" onClick={() => setBoardComposerOpen((open) => !open)} aria-label="新建看板" title="新建看板"><Plus size={15} /> 新建看板</button>
        </div>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="kanban-status-strip">
        {statsEntries.length ? statsEntries.map((item) => <span className={`status-${item.status}`} key={item.status}><i />{kanbanStatusLabels[item.status]} {item.count}</span>) : <span><i />暂无任务</span>}
      </div>
      {boardComposerOpen && (
        <div className="kanban-board-composer">
          <input autoFocus value={boardForm.name} onChange={(event) => setBoardForm({ ...boardForm, name: event.target.value })} placeholder="看板名称" />
          <input value={boardForm.slug} onChange={(event) => setBoardForm({ ...boardForm, slug: event.target.value })} placeholder="board-slug" />
          <button className="send-btn" onClick={() => void createBoard()}>创建并进入</button>
          <button className="secondary-btn" onClick={() => { setBoardComposerOpen(false); setBoardForm({ slug: '', name: '' }); }}>取消</button>
        </div>
      )}
      {loading ? <div className="empty-state">读取看板中...</div> : (
        <div className="kanban-columns">
          {visibleStatuses.map((status) => (
            <section className={`kanban-column status-${status}`} key={status}>
              <header><strong><i />{kanbanStatusLabels[status]}</strong><span>{grouped[status].length}</span></header>
              {grouped[status].length ? grouped[status].map((task) => (
                <article className="kanban-card" key={task.id}>
                  <strong>{task.title}</strong>
                  <p>{task.body || task.result || '无说明'}</p>
                  <div className="kanban-card-meta"><span>{task.assignee || '未分配'}</span><span>P{task.priority ?? 0}</span></div>
                  <div className="kanban-actions">
                    {task.status !== 'done' && <button onClick={() => void setTaskStatus(task, 'done')}>完成</button>}
                    {task.status !== 'blocked' && <button onClick={() => void setTaskStatus(task, 'blocked')}>阻塞</button>}
                    {task.status === 'blocked' && <button onClick={() => void setTaskStatus(task, 'ready')}>恢复</button>}
                    {task.status !== 'archived' && <button onClick={() => void setTaskStatus(task, 'archived')}>归档</button>}
                  </div>
                </article>
              )) : <div className="kanban-empty">暂无任务</div>}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

function ThreadActionsMenu({ thread, workspace, vaults, activeVault, activeAgent, onFollowModeChange, onCreateProjectThread, onConvertToProject, onVaultChange, onOpenAgents }: {
  thread: Thread;
  workspace: Workspace | null;
  vaults: Vault[];
  activeVault: Vault | null;
  activeAgent: Agent | null;
  onFollowModeChange: (mode: FollowMode) => Promise<void>;
  onCreateProjectThread: () => Promise<void>;
  onConvertToProject: () => void;
  onVaultChange: (vaultId: string | null) => Promise<void>;
  onOpenAgents: () => void;
}) {
  const [open, setOpen] = useState(false);
  const followLabel = thread.followMode === 'conversation' ? '对话跟随' : '默认跟随';
  const workspaceLabel = thread.mode === 'workspace' ? workspace?.name || '项目对话' : '临时对话';
  const agentLabel = activeAgent?.name || '未选择 Agent';
  return (
    <div className="thread-actions-menu">
      <button className="top-icon-btn thread-actions-trigger" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-label="对话设置" title="对话设置">
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="thread-actions-popover">
          <div className="thread-actions-summary">
            <strong>{followLabel} · {agentLabel}</strong>
            <span>{workspaceLabel}{activeVault ? ` · ${activeVault.name}` : ''}</span>
          </div>
          <div className="thread-menu-section">
            <span>跟随</span>
            <button className={(thread.followMode || 'default') === 'default' ? 'selected' : ''} onClick={() => { setOpen(false); void onFollowModeChange('default'); }}>默认跟随</button>
            <button className={thread.followMode === 'conversation' ? 'selected' : ''} onClick={() => { setOpen(false); void onFollowModeChange('conversation'); }}>对话跟随</button>
          </div>
          <div className="thread-menu-section">
            <span>项目</span>
            {thread.mode === 'workspace' ? (
              <button onClick={() => { setOpen(false); void onCreateProjectThread(); }}><Plus size={15} />新建项目对话</button>
            ) : (
              <button onClick={() => { setOpen(false); onConvertToProject(); }}><FolderOpen size={15} />转为项目</button>
            )}
          </div>
          <label className="thread-menu-select">
            <span>资料库</span>
            <select value={thread.vaultId || ''} onChange={(event) => { setOpen(false); void onVaultChange(event.target.value || null); }}>
              <option value="">不连接资料库</option>
              {vaults.map((vault) => <option key={vault.id} value={vault.id}>{vault.name}</option>)}
            </select>
          </label>
          <button className="thread-menu-wide" onClick={() => { setOpen(false); onOpenAgents(); }}><UserPlus size={15} />团队成员</button>
        </div>
      )}
    </div>
  );
}

function CodexResourcePanel({ contextPacket, proposals, workspaceArtifacts, thread, agents, workspace, isRunning, runTools, runApproval, runClarification, runError, runDraft }: {
  contextPacket: ContextPacket | null;
  proposals: Proposal[];
  workspaceArtifacts: WorkArtifact[];
  thread: Thread | null;
  agents: Agent[];
  workspace: Workspace | null;
  isRunning: boolean;
  runTools: HermesRunTool[];
  runApproval: HermesRunApproval | null;
  runClarification: HermesRunClarification | null;
  runError: string;
  runDraft: string;
}) {
  const [fileEntriesByDir, setFileEntriesByDir] = useState<Record<string, WorkspaceFileEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({ '': true });
  const [fileSearch, setFileSearch] = useState('');
  const [preview, setPreview] = useState<WorkspaceFileContent | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [fileError, setFileError] = useState('');
  const workflowState = visibleWorkflowSteps(thread, { isRunning, runTools, runApproval, runClarification, runError, runDraft });
  const shouldShowTasks = workflowState.length > 0;
  const threadArtifacts: WorkArtifact[] = [
    ...(thread?.artifacts || []),
    ...proposals.slice(0, 4).map((proposal) => ({ id: proposal.id, kind: proposal.type, name: proposal.title, target: proposal.target, updatedAt: thread?.updatedAt })),
    ...(contextPacket ? [{ id: 'context-packet', kind: 'context', name: contextPacket.title || '上下文包', target: contextPacket.policy, updatedAt: thread?.updatedAt }] : []),
  ];
  const artifacts: WorkArtifact[] = [
    ...threadArtifacts,
    ...workspaceArtifacts.map((artifact) => ({ ...artifact, target: artifact.relativePath || artifact.path || artifact.target })),
  ].filter((artifact, index, all) => all.findIndex((item) => `${item.kind}:${item.name}:${item.target || ''}` === `${artifact.kind}:${artifact.name}:${artifact.target || ''}`) === index).slice(0, 10);

  useEffect(() => {
    setPreview(null);
    setFileEntriesByDir({});
    setExpandedDirs({ '': true });
    setFileError('');
  }, [workspace?.id]);

  useEffect(() => {
    if (!workspace?.id || fileEntriesByDir['']) return;
    void loadDirectory('');
  }, [workspace?.id, fileEntriesByDir]);

  async function loadDirectory(dir: string) {
    if (!workspace?.id) return;
    setFileError('');
    const query = new URLSearchParams({ dir });
    const data = await fetch(`/api/workspaces/${workspace.id}/files?${query.toString()}`).then((res) => res.json());
    if (data.error) {
      setFileError(data.error);
      return;
    }
    setFileEntriesByDir((current) => ({ ...current, [dir]: data.entries || [] }));
  }

  async function openPreview(relativePath: string) {
    if (!workspace?.id || !relativePath) return;
    setPreviewLoading(true);
    setFileError('');
    const query = new URLSearchParams({ path: relativePath });
    const data = await fetch(`/api/workspaces/${workspace.id}/files/content?${query.toString()}`).then((res) => res.json()).catch((error) => ({ error: String(error) }));
    setPreviewLoading(false);
    if (data.error) {
      setFileError(data.error);
      return;
    }
    setPreview(data.file || null);
  }

  async function toggleDirectory(entry: WorkspaceFileEntry) {
    const nextOpen = !expandedDirs[entry.relativePath];
    setExpandedDirs((current) => ({ ...current, [entry.relativePath]: nextOpen }));
    if (nextOpen && !fileEntriesByDir[entry.relativePath]) await loadDirectory(entry.relativePath);
  }

  const sourceDocs = [
    ...(contextPacket?.vault.activeRules || []),
    ...(contextPacket?.vault.products || []).map((product) => `产品：${product}`),
  ].slice(0, 6);

  if (preview || previewLoading) {
    return (
      <div className="context-inner resource-panel">
        <div className="resource-preview-head">
          <button className="top-icon-btn" onClick={() => setPreview(null)} aria-label="返回资源列表" title="返回"><ArrowLeft size={17} /></button>
          <div>
            <strong>{preview?.name || '正在打开'}</strong>
            <span>{preview?.relativePath || '加载文件内容'}</span>
          </div>
          <button className="top-icon-btn" aria-label="打开外部文件" title="打开外部文件"><ExternalLink size={16} /></button>
        </div>
        {previewLoading ? (
          <div className="resource-empty">正在载入预览...</div>
        ) : preview ? (
          <FilePreview file={preview} />
        ) : null}
      </div>
    );
  }

  return (
    <div className="context-inner resource-panel">
      <section className="resource-section">
        <div className="panel-title"><span><FileText size={15} />输出</span></div>
        <div className="artifact-list">
          {artifacts.length ? artifacts.map((artifact, index) => {
            const Icon = artifactIcon(artifact.kind);
            const previewPath = artifact.relativePath || artifact.target || '';
            return (
              <button className="artifact-row" key={`${artifact.name}-${index}`} aria-label={artifact.target || artifact.relativePath || artifact.path || artifact.name} title={artifact.target || artifact.relativePath || artifact.path || artifact.name} onClick={() => void openPreview(previewPath)}>
                <Icon size={15} />
                <span><strong>{artifact.name}</strong><small>{artifact.target || artifact.relativePath || artifact.path || '当前线程'}</small></span>
              </button>
            );
          }) : <div className="resource-empty">暂无产物</div>}
        </div>
      </section>

      {shouldShowTasks && (
        <section className="resource-section">
          <div className="panel-title"><span><PauseCircle size={15} />任务</span></div>
          <div className="task-list">
            {workflowState.map((item, index) => {
              const done = item.status === 'completed';
              const active = item.status === 'running';
              const failed = item.status === 'failed';
              const Icon = done ? CheckCircle2 : active ? Clock3 : Circle;
              return (
                <div className={`task-row ${done ? 'done' : ''} ${active ? 'active' : ''} ${failed ? 'failed' : ''}`} key={`${item.title}-${index}`}>
                  <Icon size={15} />
                  <span><strong>{item.title}</strong>{item.detail && <small>{item.detail}</small>}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      <section className="resource-section">
        <div className="panel-title"><span><FolderOpen size={15} />文件</span></div>
        <label className="resource-search">
          <Search size={15} />
          <input value={fileSearch} onChange={(event) => setFileSearch(event.target.value)} placeholder="筛选文件..." />
        </label>
        <div className="file-tree">
          {workspace ? (
            <FileTree
              dir=""
              depth={0}
              entriesByDir={fileEntriesByDir}
              expandedDirs={expandedDirs}
              filter={fileSearch.trim()}
              onToggleDirectory={toggleDirectory}
              onOpenFile={openPreview}
            />
          ) : <div className="resource-empty">当前对话未绑定项目目录</div>}
        </div>
        {fileError && <div className="resource-error">{fileError}</div>}
      </section>

      {sourceDocs.length > 0 && (
        <section className="resource-section">
          <div className="panel-title"><span><Library size={15} />来源</span></div>
          <div className="source-list">
            {sourceDocs.map((doc) => <span key={doc}>{doc}</span>)}
          </div>
        </section>
      )}
    </div>
  );
}

type ThreadOverviewRound = {
  id: string;
  startMessageId: string;
  title: string;
  summary: string;
  messageIds: string[];
  agentNames: string[];
};

function ThreadOverviewRail({ rounds, activeRoundId, onJumpToRound }: {
  rounds: ThreadOverviewRound[];
  activeRoundId: string;
  onJumpToRound: (roundId: string) => void;
}) {
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  if (!rounds.length) return null;
  const previewRound = hoveredIndex >= 0 ? rounds[hoveredIndex] || rounds[0] : null;

  return (
    <div className={`thread-overview-rail ${hoveredIndex >= 0 ? 'is-hovering' : ''}`} aria-label="对话概览" onMouseLeave={() => setHoveredIndex(-1)}>
      <div className="thread-overview-marks">
        {rounds.map((round, index) => {
          const distance = hoveredIndex >= 0 ? Math.abs(index - hoveredIndex) : Number.POSITIVE_INFINITY;
          const waveLevel = distance <= 3 ? 3 - distance : -1;
          return (
            <button
              className="thread-overview-mark"
              data-wave-level={waveLevel >= 0 ? waveLevel : undefined}
              key={round.id}
              type="button"
              aria-label={`跳转到第 ${index + 1} 段对话，${round.title}`}
              title={round.title}
              onBlur={() => setHoveredIndex(-1)}
              onClick={() => onJumpToRound(round.id)}
              onFocus={() => setHoveredIndex(index)}
              onMouseEnter={() => setHoveredIndex(index)}
            />
          );
        })}
      </div>
      {previewRound && (
        <button className="thread-overview-preview" type="button" onClick={() => onJumpToRound(previewRound.id)}>
          <strong>{previewRound.title}</strong>
          <span>{previewRound.summary}</span>
          {previewRound.agentNames.length > 0 && <small>{previewRound.agentNames.join(' · ')}</small>}
        </button>
      )}
    </div>
  );
}

function buildThreadOverviewRounds(messages: ChatEvent[]): ThreadOverviewRound[] {
  const rounds: ThreadOverviewRound[] = [];
  let current: ThreadOverviewRound | null = null;
  const finishCurrent = () => {
    if (!current) return;
    current.summary = current.summary || current.title;
    current.agentNames = Array.from(new Set(current.agentNames)).slice(0, 3);
    rounds.push(current);
    current = null;
  };

  messages.forEach((message) => {
    const content = compactOverviewSnippet(message.content, 120);
    if (message.agentId === 'user' || !current) {
      if (message.agentId === 'user') finishCurrent();
      current = {
        id: `round-${rounds.length}-${message.id}`,
        startMessageId: message.id,
        title: message.agentId === 'user' ? compactOverviewTitle(message.content) : message.agentName || 'Agent 回复',
        summary: message.agentId === 'user' ? '' : content,
        messageIds: [message.id],
        agentNames: message.agentId === 'user' ? [] : [message.agentName || 'Agent'],
      };
      return;
    }
    current.messageIds.push(message.id);
    if (message.agentName) current.agentNames.push(message.agentName);
    current.summary = [current.summary, content].filter(Boolean).join(' ');
  });

  finishCurrent();
  return rounds;
}

function compactOverviewTitle(content: string) {
  const normalized = normalizeOverviewText(content);
  if (!normalized) return '新的问题';
  const sentence = normalized.split(/(?<=[。！？!?])\s*/)[0] || normalized;
  return sentence.length > 38 ? `${sentence.slice(0, 38)}...` : sentence;
}

function compactOverviewSnippet(content: string, maxLength = 86) {
  const normalized = normalizeOverviewText(content);
  if (!normalized) return '空消息';
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function normalizeOverviewText(content: string) {
  return String(content || '')
    .replace(/```[\s\S]*?```/g, ' 代码片段 ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[#>*_\-[\]]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function FileTree({ dir, depth, entriesByDir, expandedDirs, filter, onToggleDirectory, onOpenFile }: {
  dir: string;
  depth: number;
  entriesByDir: Record<string, WorkspaceFileEntry[]>;
  expandedDirs: Record<string, boolean>;
  filter: string;
  onToggleDirectory: (entry: WorkspaceFileEntry) => Promise<void>;
  onOpenFile: (relativePath: string) => Promise<void>;
}) {
  const entries = entriesByDir[dir] || [];
  if (!entries.length && dir === '') return <div className="resource-empty">暂无文件</div>;
  const normalizedFilter = filter.toLowerCase();
  return (
    <>
      {entries.filter((entry) => !normalizedFilter || entry.name.toLowerCase().includes(normalizedFilter) || entry.relativePath.toLowerCase().includes(normalizedFilter)).map((entry) => {
        const expanded = Boolean(expandedDirs[entry.relativePath]);
        const Icon = entry.kind === 'directory' ? Folder : iconForFileName(entry.name);
        return (
          <div className="file-tree-node" key={entry.relativePath}>
            <button className="file-tree-row" aria-label={entry.relativePath || entry.name} style={{ paddingLeft: 8 + depth * 14 }} onClick={() => entry.kind === 'directory' ? void onToggleDirectory(entry) : void onOpenFile(entry.relativePath)} disabled={entry.kind === 'file' && !entry.previewable}>
              {entry.kind === 'directory' ? <ChevronRight className={expanded ? 'expanded' : ''} size={14} /> : <span className="file-indent" />}
              <Icon size={15} />
              <span>{entry.name}</span>
            </button>
            {entry.kind === 'directory' && expanded && <FileTree dir={entry.relativePath} depth={depth + 1} entriesByDir={entriesByDir} expandedDirs={expandedDirs} filter={filter} onToggleDirectory={onToggleDirectory} onOpenFile={onOpenFile} />}
          </div>
        );
      })}
    </>
  );
}

function FilePreview({ file }: { file: WorkspaceFileContent }) {
  if (file.mimeKind === 'markdown' || file.mimeKind === 'text') {
    return (
      <article className="file-preview markdown-preview">
        <pre>{file.content || ''}</pre>
        {file.truncated && <div className="resource-empty">文件超过 1MB，已截断预览。</div>}
      </article>
    );
  }
  if (file.mimeKind === 'json' || file.mimeKind === 'code') {
    return (
      <article className="file-preview code-preview">
        <pre>{file.content || ''}</pre>
        {file.truncated && <div className="resource-empty">文件超过 1MB，已截断预览。</div>}
      </article>
    );
  }
  return (
    <div className="file-preview unsupported-preview">
      <FileText size={28} />
      <strong>{file.name}</strong>
      <span>{formatFileSize(file.size)} · {file.mimeKind === 'pdf' ? 'PDF' : file.mimeKind === 'image' ? '图片' : '二进制文件'}</span>
      <p>暂不内嵌预览。</p>
    </div>
  );
}

function artifactIcon(kind: string) {
  if (kind === 'context') return Library;
  if (kind === 'plan' || kind === 'document' || kind === 'report') return FileText;
  if (kind === 'data') return Boxes;
  if (kind === 'script') return Settings;
  if (kind === 'pdf') return FileText;
  return CheckCircle2;
}

function iconForFileName(fileName: string) {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.md') || lower.endsWith('.markdown') || lower.endsWith('.txt')) return FileText;
  if (lower.endsWith('.json') || lower.endsWith('.ts') || lower.endsWith('.tsx') || lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.py') || lower.endsWith('.css') || lower.endsWith('.html') || lower.endsWith('.yml') || lower.endsWith('.yaml')) return Code2;
  if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.webp') || lower.endsWith('.gif')) return Image;
  return File;
}

const defaultCouncilWorkflowTitles = ['Iris 接收需求', 'Max 拆解任务', '相关 Agent 协作', '生成待确认动作'];

function isLegacyDefaultWorkflow(steps: WorkflowStep[]) {
  if (steps.length !== defaultCouncilWorkflowTitles.length) return false;
  return steps.every((step, index) => step.title === defaultCouncilWorkflowTitles[index] && !step.source && !step.detail && !step.agentName);
}

function visibleWorkflowSteps(thread: Thread | null, live: { isRunning: boolean; runTools: HermesRunTool[]; runApproval: HermesRunApproval | null; runClarification: HermesRunClarification | null; runError: string; runDraft: string }): WorkflowStep[] {
  const liveSteps: WorkflowStep[] = [];
  if (live.isRunning) liveSteps.push({ title: 'Agent 正在执行', status: 'running', source: 'run', detail: live.runDraft ? '正在思考' : '' });
  for (const tool of live.runTools) {
    liveSteps.push({
      title: tool.title || tool.label || tool.toolName || tool.tool || '工具调用',
      status: tool.status === 'failed' ? 'failed' : tool.status === 'completed' ? 'completed' : 'running',
      source: 'tool',
      detail: formatToolDetail(tool),
      updatedAt: tool.updatedAt,
      callId: tool.id,
    });
  }
  if (live.runApproval) liveSteps.push({ title: live.runApproval.title || '等待确认', status: 'running', source: 'approval', detail: live.runApproval.command || live.runApproval.tool || '' });
  if (live.runClarification) liveSteps.push({ title: '等待你的选择', status: 'running', source: 'clarify', detail: live.runClarification.question, callId: live.runClarification.id });
  if (live.runError) liveSteps.push({ title: live.runError, status: 'failed', source: 'run' });
  if (liveSteps.length) return liveSteps;

  const steps = Array.isArray(thread?.workflowState) ? thread.workflowState : [];
  if (!steps.length || isLegacyDefaultWorkflow(steps)) return [];
  const hasRealSignal = steps.some((step) => step.source || step.detail || step.agentName);
  if (!hasRealSignal && thread?.runStatus !== 'running') return [];
  return steps.map((step) => thread?.runStatus !== 'running' && step.status === 'running' ? { ...step, status: 'completed' } : step);
}

function formatToolDetail(tool: HermesRunTool) {
  const parts = [
    tool.paths?.length ? tool.paths.slice(0, 3).join(' · ') : '',
    tool.fileCount ? `${tool.fileCount} 个文件` : '',
    tool.skillName || '',
    tool.duration ? `${Math.round(tool.duration * 10) / 10}s` : '',
    !tool.paths?.length && !tool.fileCount ? tool.detail || tool.resultPreview || tool.argsPreview || '' : '',
  ].filter(Boolean);
  return parts.join(' · ');
}

function PermissionModeControl({ value, onChange }: { value: PermissionMode; onChange: (mode: PermissionMode) => void }) {
  const [open, setOpen] = useState(false);
  const CurrentIcon = permissionIcon(value);
  return (
    <div className="permission-menu-wrap">
      <button className={`permission-select ${permissionTone(value)}`} type="button" title={permissionDescription(value)} aria-label="操作权限" onClick={() => setOpen((current) => !current)}>
        <CurrentIcon size={15} />
        <span>{permissionLabel(value)}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="permission-menu" role="menu">
          <div className="permission-menu-head">
            <strong>应如何批准 Hermes 操作？</strong>
            <a href="#settings" onClick={(event) => event.preventDefault()}>了解更多</a>
          </div>
          {(['manual', 'smart', 'off'] as const).map((mode) => {
            const Icon = permissionIcon(mode);
            const selected = mode === value;
            return (
              <button
                className={selected ? 'selected' : ''}
                key={mode}
                type="button"
                role="menuitemradio"
                aria-checked={selected}
                onClick={() => {
                  onChange(mode);
                  setOpen(false);
                }}
              >
                <Icon size={20} />
                <span><strong>{permissionLabel(mode)}</strong><small>{permissionDescription(mode)}</small></span>
                {selected && <CheckCircle2 size={18} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MonitoringPage({ embedded = false }: { embedded?: boolean }) {
  const [summary, setSummary] = useState<MonitoringSummary | null>(null);
  const [moduleMode, setModuleMode] = useState<'skills' | 'plugins'>('skills');
  const [analysisTab, setAnalysisTab] = useState<AnalysisTab>('trend');
  const [loading, setLoading] = useState(false);
  const [providerFilter, setProviderFilter] = useState('all');
  const [modelFilter, setModelFilter] = useState('all');
  const [profileFilter, setProfileFilter] = useState('all');
  const [refreshMode, setRefreshMode] = useState<'30' | '0'>('30');
  const [rangeMode, setRangeMode] = useState<UsageRangeMode>('today');
  const allUsage = summary?.usage;
  const usageEntries = allUsage?.entries || [];
  const hasEntryData = usageEntries.length > 0;
  const rangeEntries = usageEntries.filter((entry) => {
    const time = new Date(entry.createdAt || '').getTime();
    return Number.isFinite(time) && time >= usageRangeStart(rangeMode);
  });
  const usageBySource = hasEntryData ? aggregateUsageSources(rangeEntries) : allUsage?.bySource || [];
  const usageByModel = hasEntryData ? aggregateUsageModels(rangeEntries) : allUsage?.byModel || [];
  const sourceOptions = usageBySource.map((row) => row.source).filter(Boolean);
  const modelOptions = usageByModel.filter((row) => row.requests > 0).map((row) => row.modelName).filter(Boolean);
  const profileOptions = Array.from(new Set((hasEntryData ? rangeEntries.map((entry) => entry.profileName || entry.agentNames?.[0] || '') : allUsage?.byProfile?.map((row) => row.profileName) || []).filter(Boolean))).sort((a, b) => a.localeCompare(b));
  const profileEntries = profileFilter === 'all' ? rangeEntries : rangeEntries.filter((entry) => (entry.profileName || entry.agentNames?.[0] || '') === profileFilter);
  const filteredEntries = filterEntriesBySelection(profileEntries, providerFilter, modelFilter);
  const filteredModels = (hasEntryData ? aggregateUsageModels(filteredEntries) : usageByModel.filter((row) => {
    const sourceMatched = providerFilter === 'all' || row.provider === providerFilter || Object.keys(row.dataSources || {}).includes(providerFilter);
    const modelMatched = modelFilter === 'all' || row.modelName === modelFilter;
    return sourceMatched && modelMatched;
  })).filter((row) => row.requests > 0 || Number(row.realTotalTokens || row.totalTokens || 0) > 0);
  const usage = {
    totalRequests: filteredModels.reduce((sum, row) => sum + row.requests, 0),
    realTotalTokens: filteredModels.reduce((sum, row) => sum + Number(row.realTotalTokens ?? row.totalTokens ?? 0), 0),
    inputTokens: filteredModels.reduce((sum, row) => sum + row.inputTokens, 0),
    outputTokens: filteredModels.reduce((sum, row) => sum + row.outputTokens, 0),
    cacheReadTokens: filteredModels.reduce((sum, row) => sum + Number(row.cacheReadTokens || 0), 0),
    cacheCreationTokens: filteredModels.reduce((sum, row) => sum + Number(row.cacheCreationTokens || 0), 0),
    totalCost: filteredModels.reduce((sum, row) => sum + Number(row.totalCost || 0), 0),
    estimatedRequests: filteredModels.reduce((sum, row) => sum + row.estimatedRequests, 0),
  };
  const cacheableInput = usage.inputTokens + usage.cacheReadTokens;
  const cacheHitRate = cacheableInput > 0 ? usage.cacheReadTokens / cacheableInput : 0;
  const maxTokens = Math.max(1, ...filteredModels.map((row) => Number(row.realTotalTokens ?? row.totalTokens ?? 0)));
  const trendPoints = hasEntryData ? aggregateUsageTrendPoints(filteredEntries, rangeMode) : buildUsageTrendPointsFromDays(allUsage?.byDay || []);
  const modelMetricRows = aggregateUsageByModelMetric(filteredEntries, filteredModels);
  const requestSeries = buildModelBarSeries(modelMetricRows, 'requests');
  const donutRows = buildDonutRows(modelMetricRows);
  const donutSegments = buildDonutSegments(donutRows);
  const rangeLabel = usageRangeLabel(rangeMode);
  const latestTrendIndex = latestActiveTrendIndex(trendPoints);
  const latestTrend = trendPoints[latestTrendIndex];
  const previousTrend = latestTrendIndex > 0 ? trendPoints[latestTrendIndex - 1] : undefined;
  const latestTokens = Number(latestTrend?.realTotalTokens || 0);
  const previousTokens = Number(previousTrend?.realTotalTokens || 0);
  const tokenDelta = previousTrend ? latestTokens - previousTokens : latestTokens;
  const tokenDeltaRatio = previousTrend && previousTokens > 0 ? tokenDelta / previousTokens : null;

  async function loadMonitoring() {
    setLoading(true);
    try {
      const data = await fetch('/api/monitoring/summary').then((res) => res.json());
      setSummary(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMonitoring();
  }, []);

  useEffect(() => {
    if (refreshMode !== '30') return undefined;
    const timer = window.setInterval(() => void loadMonitoring(), 30_000);
    return () => window.clearInterval(timer);
  }, [refreshMode]);

  const modules = moduleMode === 'skills' ? summary?.modules.skills : summary?.modules.plugins;
  return (
    <section className={embedded ? 'embedded-management-page monitoring-page' : 'settings-page monitoring-page'}>
      <div className="monitoring-shell">
        <div className="settings-head monitoring-head">
          <div>
            <h2>监控</h2>
          </div>
          <button className={`secondary-btn ${loading ? 'is-loading' : ''}`} onClick={() => void loadMonitoring()} disabled={loading}><RefreshCw size={15} />{loading ? '刷新中' : '刷新'}</button>
        </div>

      <div className="usage-toolbar" aria-label="监控筛选">
        <label><span>来源</span><select value={providerFilter} onChange={(event) => setProviderFilter(event.target.value)}><option value="all">全部来源</option>{sourceOptions.map((source) => <option key={source} value={source}>{source}</option>)}</select><ChevronDown size={15} /></label>
        <label><span>模型</span><select value={modelFilter} onChange={(event) => setModelFilter(event.target.value)}><option value="all">全部模型</option>{modelOptions.map((model) => <option key={model} value={model}>{model}</option>)}</select><ChevronDown size={15} /></label>
        <label><span>Profile</span><select value={profileFilter} onChange={(event) => setProfileFilter(event.target.value)}><option value="all">全部 Profile</option>{profileOptions.map((profile) => <option key={profile} value={profile}>{profile}</option>)}</select><ChevronDown size={15} /></label>
        <label><RefreshCw size={15} /><select value={refreshMode} onChange={(event) => setRefreshMode(event.target.value as '30' | '0')}><option value="30">30s</option><option value="0">手动</option></select><ChevronDown size={15} /></label>
        <label><Clock3 size={15} /><select value={rangeMode} onChange={(event) => setRangeMode(event.target.value as UsageRangeMode)}><option value="today">当天</option><option value="7">7 天</option><option value="15">15 天</option><option value="30">一个月</option><option value="90">3 个月</option><option value="180">6 个月</option><option value="365">1 年</option></select><ChevronDown size={15} /></label>
      </div>

      <section className="usage-summary-card">
        <div className="usage-summary-top">
          <div className="usage-total-block">
            <div className="usage-total-icon"><ZapIcon /></div>
            <div>
              <span>真实消耗 Tokens</span>
              <strong>{formatFullNumber(usage.realTotalTokens)}</strong>
              <small>≈ {formatChineseApproxNumber(usage.realTotalTokens)} · {summary?.hermesAgent ? `${summary.hermesAgent.usageSource} · ${summary.hermesAgent.databaseCount} profiles` : '兼容汇总'}</small>
            </div>
          </div>
          <div className="usage-cost-pill">
            <div><span>总请求数</span><strong><Activity size={15} />{formatFullNumber(usage.totalRequests)}</strong></div>
            <i />
            <div><span>总成本</span><strong className="money">{formatUsd(usage.totalCost)}</strong></div>
          </div>
        </div>

        <div className="usage-breakdown-grid">
          <UsageMiniStat icon={<ArrowDownToLine size={16} />} label="新增输入" value={formatWanNumber(usage.inputTokens)} />
          <UsageMiniStat icon={<ArrowUpFromLine size={16} />} label="Output" value={formatWanNumber(usage.outputTokens)} accent="purple" />
          <UsageMiniStat icon={<Sparkles size={16} />} label="命中" value={formatWanNumber(usage.cacheReadTokens)} accent="green" />
          <div className="cache-hit-card">
            <div><span>缓存命中率</span><strong>{(cacheHitRate * 100).toFixed(cacheHitRate > .999 ? 0 : 1)}%</strong></div>
            <span className="hit-track"><i style={{ width: `${Math.max(0, Math.min(100, cacheHitRate * 100))}%` }} /></span>
          </div>
        </div>
      </section>

      <section className="monitor-panel analysis-panel">
        <div className="panel-title analysis-title">
          <div><span>模型数据分析</span><small>{rangeMode === 'today' ? '当天按小时统计' : `${rangeLabel}按天统计`}</small></div>
          <div className="analysis-tabs" role="tablist" aria-label="模型数据分析">
            {[
              ['cost', '消耗分布'],
              ['trend', '调用趋势'],
              ['requests', '调用次数分布'],
              ['ranking', '调用次数排行'],
            ].map(([id, label]) => (
              <React.Fragment key={id}>
                <button className={analysisTab === id ? 'selected' : ''} onClick={() => setAnalysisTab(id as AnalysisTab)} type="button">{label}</button>
              </React.Fragment>
            ))}
          </div>
        </div>

        {analysisTab === 'trend' && (
          <div className="analysis-chart">
            <div className="analysis-chart-head">
              <div><strong>调用趋势</strong><span>{latestTrend ? `${latestTrend.label} · ${formatCompactNumber(latestTokens)} tokens` : '等待数据进入'}</span></div>
              <em className={tokenDelta >= 0 ? 'growth-positive' : 'growth-negative'}>{rangeLabel} · {formatDelta(tokenDelta, tokenDeltaRatio)}</em>
            </div>
            <UsageTrendRechart points={trendPoints} hourly={rangeMode === 'today'} />
          </div>
        )}

        {analysisTab === 'cost' && (
          <div className="analysis-donut-view">
            <div className="donut-legend">
              <strong>模型消耗分布</strong>
              <span>总计：{formatCompactNumber(usage.realTotalTokens)} tokens</span>
              {donutRows.map((row) => (
                <div className="donut-legend-row" key={row.key}>
                  <i style={{ background: row.color }} />
                  <span>{row.modelName}</span>
                  <em>{formatDonutShare(row.displayShare)}</em>
                </div>
              ))}
            </div>
            <div className="donut-chart-wrap">
              <svg className="donut-chart" viewBox="0 0 120 120" aria-hidden="true">
                <circle className="donut-ring-base" cx="60" cy="60" r="38" pathLength="100" />
                {donutSegments.map((segment) => <circle className="donut-ring-segment" key={segment.key} cx="60" cy="60" r="38" pathLength="100" style={{ stroke: segment.color, strokeDasharray: `${segment.length} ${segment.gap}`, strokeDashoffset: segment.offset }} />)}
              </svg>
              <div><strong>{donutRows[0] ? formatDonutShare(donutRows[0].displayShare) : '0%'}</strong><span>{donutRows[0]?.modelName || '暂无模型'}</span></div>
            </div>
          </div>
        )}

        {analysisTab === 'requests' && (
          <div className="analysis-bar-view">
            <div className="analysis-chart-head"><div><strong>模型调用次数占比</strong><span>总计：{formatFullNumber(usage.totalRequests)} 次</span></div></div>
            <div className="analysis-bars-chart">
              {requestSeries.map((bar) => (
                <div className="analysis-model-bar" key={bar.key}>
                  <span>{bar.label}</span>
                  <i style={{ height: `${Math.max(2, bar.height)}%`, background: bar.color }} />
                  <em>{formatFullNumber(bar.value)}</em>
                </div>
              ))}
              {!requestSeries.length && <p className="muted-copy">暂无调用次数数据。</p>}
            </div>
          </div>
        )}

        {analysisTab === 'ranking' && (
          <div className="analysis-ranking">
            <div className="analysis-chart-head"><div><strong>调用次数排行</strong><span>按模型请求数降序</span></div></div>
            {modelMetricRows.slice(0, 8).map((row, index) => (
              <div className="analysis-rank-row" key={row.key}>
                <b>{index + 1}</b>
                <div><strong>{row.modelName}</strong><small>{row.provider} · {formatCompactNumber(row.realTotalTokens)} tokens · {formatUsd(row.totalCost)}</small></div>
                <span>{formatFullNumber(row.requests)}</span>
                <i><em style={{ width: `${Math.max(3, row.share)}%`, background: row.color }} /></i>
              </div>
            ))}
            {!modelMetricRows.length && <p className="muted-copy">暂无调用排行数据。</p>}
          </div>
        )}
      </section>

      <section className="monitor-panel wide monitor-model-panel">
        <div className="panel-title"><span>模型用量与成本</span><Bot size={15} /></div>
        <div className="usage-bars">
          {filteredModels.slice(0, 8).map((row) => (
            <div className="usage-bar-row" key={row.key}>
              <div><strong>{row.modelName}</strong><small>{row.provider} · {row.requests} requests · {pricingSourceLabel(row.pricingSource)}</small></div>
              <div className="usage-bar-track"><span style={{ width: `${Math.max(3, (Number(row.realTotalTokens ?? row.totalTokens ?? 0) / maxTokens) * 100)}%` }} /></div>
              <em>{formatCompactNumber(Number(row.realTotalTokens ?? row.totalTokens ?? 0))}<small>{formatUsd(Number(row.totalCost || 0))}</small></em>
            </div>
          ))}
          {!filteredModels.length && <p className="muted-copy">还没有匹配的模型调用记录。发起一次真实模型对话后这里会开始累计。</p>}
        </div>
      </section>

      <div className="monitor-grid">
        <section className="monitor-panel">
          <div className="panel-title"><span>系统日志</span><FileText size={15} /></div>
          <div className="log-list">
            {(summary?.logs || []).slice(0, 18).map((log, index) => (
              <div className={`log-row ${log.level}`} key={`${log.source}-${index}`}>
                <strong>{log.source}</strong>
                <span>{log.message}</span>
              </div>
            ))}
            {!summary?.logs.length && <p className="muted-copy">没有读取到 Hermes 日志文件。</p>}
          </div>
        </section>

        <section className="monitor-panel module-usage-panel">
          <div className="panel-title">
            <span>技能与插件用量</span>
            <div className="mini-segment">
              <button className={moduleMode === 'skills' ? 'selected' : ''} onClick={() => setModuleMode('skills')}>技能</button>
              <button className={moduleMode === 'plugins' ? 'selected' : ''} onClick={() => setModuleMode('plugins')}>插件</button>
            </div>
          </div>
          <div className="module-usage-list">
            {(modules?.byName || []).slice(0, 12).map((row) => (
              <div className="module-usage-row" key={row.name}>
                <span><strong>{row.name}</strong><small>{row.enabledProfiles || 0}/{row.profiles || 0} enabled</small></span>
                <em>{formatCompactNumber(row.useCount + row.viewCount + row.patchCount)}</em>
              </div>
            ))}
            {!modules?.byName.length && <p className="muted-copy">暂无{moduleMode === 'skills' ? '技能' : '插件'}用量记录。</p>}
          </div>
        </section>
      </div>
      </div>
    </section>
  );
}

function usageRangeStart(rangeMode: UsageRangeMode) {
  const nowDate = new Date();
  if (rangeMode === 'today') {
    const start = new Date(nowDate);
    start.setHours(0, 0, 0, 0);
    return start.getTime();
  }
  const start = new Date(nowDate);
  start.setDate(start.getDate() - (Number(rangeMode) - 1));
  start.setHours(0, 0, 0, 0);
  return start.getTime();
}

function usageRangeLabel(rangeMode: UsageRangeMode) {
  if (rangeMode === 'today') return '当天';
  if (rangeMode === '30') return '一个月';
  if (rangeMode === '90') return '3 个月';
  if (rangeMode === '180') return '6 个月';
  if (rangeMode === '365') return '1 年';
  return `${rangeMode} 天`;
}

function latestActiveTrendIndex(points: UsageTrendPoint[]) {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const row = points[index];
    if (Number(row.realTotalTokens || 0) > 0 || Number(row.requests || 0) > 0) return index;
  }
  return Math.max(0, points.length - 1);
}

function filterEntriesBySelection(entries: UsageEntry[], source: string, model: string) {
  return entries.filter((entry) => {
    const sourceValue = entry.dataSource || entry.provider || 'Frakio Work';
    const sourceMatched = source === 'all' || sourceValue === source || entry.provider === source;
    const modelMatched = model === 'all' || entry.modelName === model;
    return sourceMatched && modelMatched;
  });
}

function aggregateUsageModels(entries: UsageEntry[]): ModelUsageRow[] {
  const byModel = new Map<string, ModelUsageRow>();
  for (const entry of entries) {
    const key = `${entry.provider || 'unknown'}:${entry.modelId || entry.modelName || 'unknown'}`;
    const current = byModel.get(key) || {
      key,
      provider: entry.provider || 'unknown',
      modelId: entry.modelId || '',
      modelName: entry.modelName || entry.modelId || 'unknown',
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      realTotalTokens: 0,
      totalCost: 0,
      pricing: entry.pricing,
      pricingSource: entry.pricingSource,
      estimatedRequests: 0,
      lastUsedAt: entry.createdAt || null,
      dataSources: {},
    };
    current.requests += 1;
    current.inputTokens += Number(entry.inputTokens || 0);
    current.outputTokens += Number(entry.outputTokens || 0);
    current.cacheReadTokens += Number(entry.cacheReadTokens || 0);
    current.cacheCreationTokens += Number(entry.cacheCreationTokens || 0);
    current.totalTokens += Number(entry.totalTokens || 0);
    current.realTotalTokens += Number(entry.realTotalTokens || entry.totalTokens || 0);
    current.totalCost += Number(entry.totalCost || 0);
    current.estimatedRequests += entry.estimated ? 1 : 0;
    current.pricing = entry.pricing || current.pricing;
    current.pricingSource = entry.pricingSource || current.pricingSource;
    current.lastUsedAt = entry.createdAt && (!current.lastUsedAt || entry.createdAt.localeCompare(current.lastUsedAt) > 0) ? entry.createdAt : current.lastUsedAt;
    const source = entry.dataSource || entry.provider || 'Frakio Work';
    current.dataSources = current.dataSources || {};
    current.dataSources[source] = (current.dataSources[source] || 0) + 1;
    byModel.set(key, current);
  }
  return Array.from(byModel.values()).sort((a, b) => b.realTotalTokens - a.realTotalTokens);
}

function aggregateUsageSources(entries: UsageEntry[]): UsageSource[] {
  const bySource = new Map<string, UsageSource>();
  for (const entry of entries) {
    const source = entry.dataSource || entry.provider || 'Frakio Work';
    const current = bySource.get(source) || { source, requests: 0, totalTokens: 0, realTotalTokens: 0, totalCost: 0 };
    current.requests += 1;
    current.totalTokens += Number(entry.totalTokens || 0);
    current.realTotalTokens += Number(entry.realTotalTokens || entry.totalTokens || 0);
    current.totalCost += Number(entry.totalCost || 0);
    bySource.set(source, current);
  }
  return Array.from(bySource.values()).sort((a, b) => b.realTotalTokens - a.realTotalTokens);
}

function aggregateUsageDays(entries: UsageEntry[]): UsageDay[] {
  const byDay = new Map<string, UsageDay>();
  for (const entry of entries) {
    const day = String(entry.createdAt || '').slice(0, 10);
    if (!day) continue;
    const current = byDay.get(day) || { day, requests: 0, totalTokens: 0, realTotalTokens: 0, totalCost: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
    current.requests += 1;
    current.totalTokens += Number(entry.totalTokens || 0);
    current.realTotalTokens += Number(entry.realTotalTokens || entry.totalTokens || 0);
    current.totalCost += Number(entry.totalCost || 0);
    current.inputTokens += Number(entry.inputTokens || 0);
    current.outputTokens += Number(entry.outputTokens || 0);
    current.cacheReadTokens += Number(entry.cacheReadTokens || 0);
    current.cacheCreationTokens += Number(entry.cacheCreationTokens || 0);
    byDay.set(day, current);
  }
  return Array.from(byDay.values()).sort((a, b) => a.day.localeCompare(b.day));
}

function aggregateUsageTrendPoints(entries: UsageEntry[], rangeMode: UsageRangeMode): UsageTrendPoint[] {
  if (rangeMode !== 'today') {
    return aggregateUsageDays(entries).map((row) => ({
      key: row.day,
      label: row.day.slice(5),
      requests: row.requests,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      realTotalTokens: row.realTotalTokens,
      cost: row.totalCost,
    }));
  }
  const nowDate = new Date();
  const currentDay = `${nowDate.getFullYear()}-${String(nowDate.getMonth() + 1).padStart(2, '0')}-${String(nowDate.getDate()).padStart(2, '0')}`;
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    key: `${currentDay}-${String(hour).padStart(2, '0')}`,
    label: `${String(nowDate.getMonth() + 1).padStart(2, '0')}/${String(nowDate.getDate()).padStart(2, '0')} ${String(hour).padStart(2, '0')}:00`,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    realTotalTokens: 0,
    cost: 0,
  }));
  for (const entry of entries) {
    const date = new Date(entry.createdAt || '');
    if (Number.isNaN(date.getTime())) continue;
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (day !== currentDay) continue;
    const current = rows[date.getHours()];
    current.requests += 1;
    current.realTotalTokens += Number(entry.realTotalTokens || entry.totalTokens || 0);
    current.cost += Number(entry.totalCost || 0);
    current.inputTokens += Number(entry.inputTokens || 0);
    current.outputTokens += Number(entry.outputTokens || 0);
    current.cacheReadTokens += Number(entry.cacheReadTokens || 0);
    current.cacheCreationTokens += Number(entry.cacheCreationTokens || 0);
  }
  return rows;
}

function buildUsageTrendPointsFromDays(rows: UsageDay[]): UsageTrendPoint[] {
  return rows.map((row) => {
    return {
      key: row.day,
      label: row.day.slice(5),
      requests: row.requests,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheCreationTokens: row.cacheCreationTokens,
      cacheReadTokens: row.cacheReadTokens,
      realTotalTokens: row.realTotalTokens,
      cost: row.totalCost,
    };
  });
}

function aggregateUsageByModelMetric(entries: UsageEntry[], fallbackModels: ModelUsageRow[]): ModelMetricRow[] {
  const sourceRows = entries.length ? aggregateUsageModels(entries) : fallbackModels;
  const totalTokens = sourceRows.reduce((sum, row) => sum + Number(row.realTotalTokens || row.totalTokens || 0), 0);
  const palette = ['#31527d', '#f2b705', '#0f766e', '#7c3aed', '#ef6f91', '#22a7c7', '#f97316', '#64748b'];
  return sourceRows
    .filter((row) => row.requests > 0 || Number(row.realTotalTokens || row.totalTokens || 0) > 0)
    .sort((a, b) => b.requests - a.requests || Number(b.realTotalTokens || b.totalTokens || 0) - Number(a.realTotalTokens || a.totalTokens || 0))
    .map((row, index) => {
      const realTotalTokens = Number(row.realTotalTokens || row.totalTokens || 0);
      return {
        key: row.key,
        provider: row.provider,
        modelName: row.modelName,
        requests: row.requests,
        realTotalTokens,
        totalCost: Number(row.totalCost || 0),
        share: totalTokens > 0 ? (realTotalTokens / totalTokens) * 100 : 0,
        color: palette[index % palette.length],
      };
    });
}

function buildModelBarSeries(rows: ModelMetricRow[], metric: keyof Pick<ModelMetricRow, 'requests' | 'realTotalTokens' | 'totalCost'>) {
  const visible = rows.slice(0, 8);
  const maxValue = Math.max(1, ...visible.map((row) => Number(row[metric] || 0)));
  return visible.map((row) => ({
    key: row.key,
    label: row.modelName,
    value: Number(row[metric] || 0),
    height: (Number(row[metric] || 0) / maxValue) * 100,
    color: row.color,
  }));
}

function buildDonutRows(rows: ModelMetricRow[]): DonutMetricRow[] {
  const palette = ['#31527d', '#f2b705', '#0f766e', '#7c3aed', '#ef6f91', '#22a7c7'];
  const sourceRows = rows
    .filter((row) => Number(row.realTotalTokens || 0) > 0)
    .sort((a, b) => b.realTotalTokens - a.realTotalTokens);
  const topRows = sourceRows.slice(0, 5).map((row, index) => ({ ...row, displayShare: 0, color: palette[index] }));
  const otherRows = sourceRows.slice(5);
  if (!otherRows.length) return normalizeDonutShares(topRows);
  const otherTokens = otherRows.reduce((sum, row) => sum + row.realTotalTokens, 0);
  const otherRequests = otherRows.reduce((sum, row) => sum + row.requests, 0);
  const otherCost = otherRows.reduce((sum, row) => sum + row.totalCost, 0);
  return normalizeDonutShares([
    ...topRows,
    {
      key: 'other',
      modelName: '其他',
      requests: otherRequests,
      realTotalTokens: otherTokens,
      totalCost: otherCost,
      share: 0,
      displayShare: 0,
      color: palette[5],
    },
  ]);
}

function normalizeDonutShares(rows: DonutMetricRow[]): DonutMetricRow[] {
  const totalTokens = rows.reduce((sum, row) => sum + row.realTotalTokens, 0);
  if (totalTokens <= 0) return [];
  let usedShare = 0;
  const normalized = rows.map((row, index) => {
    const isLast = index === rows.length - 1;
    const share = isLast ? Math.max(0, 100 - usedShare) : (row.realTotalTokens / totalTokens) * 100;
    usedShare += share;
    return { ...row, share };
  });
  const displayShares = normalized.map((row) => Math.round(row.share * 10) / 10);
  if (displayShares.length) {
    const displayedBeforeLast = displayShares.slice(0, -1).reduce((sum, share) => sum + share, 0);
    displayShares[displayShares.length - 1] = Math.max(0, Math.round((100 - displayedBeforeLast) * 10) / 10);
  }
  return normalized.map((row, index) => ({ ...row, displayShare: displayShares[index] || 0 }));
}

function buildDonutSegments(rows: DonutMetricRow[]) {
  const visible = rows.length ? rows : [{ key: 'empty', color: '#dbe5df', share: 100, displayShare: 100 }] as DonutMetricRow[];
  let offset = 25;
  return visible.map((row) => {
    const length = rows.length ? row.share : 100;
    const segment = { key: row.key, color: row.color, length, gap: Math.max(0, 100 - length), offset: -offset };
    offset += length;
    return segment;
  });
}

function formatDonutShare(value: number) {
  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function formatDelta(value: number, ratio: number | null) {
  const sign = value >= 0 ? '+' : '-';
  const amount = formatCompactNumber(Math.abs(value));
  if (ratio === null) return `${sign}${amount}`;
  return `${sign}${amount} · ${sign}${Math.abs(ratio * 100).toFixed(1)}%`;
}

function UsageTrendRechart({ points, hourly }: { points: UsageTrendPoint[]; hourly: boolean }) {
  if (!points.length) return <div className="usage-trend-scroll"><div className="usage-trend-rechart empty"><p className="muted-copy">暂无趋势数据。</p></div></div>;
  const timelineTicks = pickTimelineTicks(points, 12);
  const chartMinWidth = hourly
    ? Math.max(760, points.length * 42)
    : Math.min(1320, Math.max(720, points.length * 68));
  const tooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    const row = payload[0]?.payload as UsageTrendPoint | undefined;
    return (
      <div className="usage-chart-tooltip">
        <strong>{label}</strong>
        <span>请求数：{formatFullNumber(row?.requests || 0)} 次</span>
        {payload.map((entry: { color?: string; name?: string | number; dataKey?: string | number; value?: unknown }) => (
          <em key={entry.dataKey} style={{ color: entry.color }}>
            <i style={{ background: entry.color }} />
            {entry.name}：{entry.dataKey === 'cost' ? formatUsd(Number(entry.value || 0)) : formatFullNumber(Number(entry.value || 0))}
          </em>
        ))}
      </div>
    );
  };
  return (
    <div className="usage-trend-scroll" aria-label="调用趋势时间线">
      <div className="usage-trend-rechart" style={{ minWidth: `${chartMinWidth}px` }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={points} margin={{ top: 10, right: 12, left: 0, bottom: 4 }}>
            <defs>
              <linearGradient id="usageInputFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} /><stop offset="95%" stopColor="#3b82f6" stopOpacity={0} /></linearGradient>
              <linearGradient id="usageOutputFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.2} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient>
              <linearGradient id="usageCacheCreationFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#f97316" stopOpacity={0.18} /><stop offset="95%" stopColor="#f97316" stopOpacity={0} /></linearGradient>
              <linearGradient id="usageCacheReadFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#a855f7" stopOpacity={0.18} /><stop offset="95%" stopColor="#a855f7" stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#d8e1dc" opacity={0.72} />
            <XAxis dataKey="label" ticks={timelineTicks} axisLine={false} tickLine={false} interval={0} minTickGap={0} height={42} tick={{ fill: '#73807b', fontSize: 12 }} dy={10} />
            <YAxis yAxisId="tokens" axisLine={false} tickLine={false} tick={{ fill: '#73807b', fontSize: 12 }} tickFormatter={(value) => `${Math.round(Number(value) / 1000)}k`} width={48} />
            <YAxis yAxisId="cost" orientation="right" axisLine={false} tickLine={false} tick={{ fill: '#73807b', fontSize: 12 }} tickFormatter={(value) => `$${Number(value).toFixed(Number(value) >= 10 ? 0 : 2)}`} width={50} />
            <Tooltip content={tooltip} cursor={{ stroke: '#0f766e', strokeWidth: 1, strokeDasharray: '4 4', opacity: 0.35 }} />
            <Legend verticalAlign="bottom" height={32} iconType="circle" wrapperStyle={{ color: '#52615c', fontSize: 12, paddingTop: 10 }} />
            <Area yAxisId="tokens" type="monotone" dataKey="inputTokens" name="输入 Tokens" stroke="#3b82f6" fill="url(#usageInputFill)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Area yAxisId="tokens" type="monotone" dataKey="outputTokens" name="输出 Tokens" stroke="#22c55e" fill="url(#usageOutputFill)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Area yAxisId="tokens" type="monotone" dataKey="cacheCreationTokens" name="缓存创建" stroke="#f97316" fill="url(#usageCacheCreationFill)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Area yAxisId="tokens" type="monotone" dataKey="cacheReadTokens" name="缓存命中" stroke="#a855f7" fill="url(#usageCacheReadFill)" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
            <Area yAxisId="cost" type="monotone" dataKey="cost" name="成本" stroke="#f43f5e" fill="none" strokeWidth={2} strokeDasharray="4 4" dot={false} activeDot={{ r: 4 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function pickTimelineTicks(points: UsageTrendPoint[], maxTicks = 12) {
  const labels = points.map((point) => point.label);
  if (labels.length <= maxTicks) return labels;
  const selected = new Set<string>();
  const lastIndex = labels.length - 1;
  for (let index = 0; index < maxTicks; index += 1) {
    selected.add(labels[Math.round((index * lastIndex) / (maxTicks - 1))]);
  }
  return labels.filter((label) => selected.has(label));
}

function UsageMiniStat({ icon, label, value, accent = 'blue', muted = false }: { icon: React.ReactNode; label: string; value: string; accent?: 'blue' | 'purple' | 'green'; muted?: boolean }) {
  return (
    <div className={`usage-mini-stat ${accent} ${muted ? 'muted' : ''}`}>
      <span>{icon}{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function WorkbenchDisplaySettings({ uiSettings, onUpdateUi }: { uiSettings: WorkbenchUiSettings; onUpdateUi: (next: Partial<WorkbenchUiSettings>) => void }) {
  const rows = [
    {
      label: '流式响应',
      hint: 'Agent 回复按打字节奏展示。',
      checked: uiSettings.streamingResponses !== false,
      onChange: (checked: boolean) => onUpdateUi({ streamingResponses: checked }),
    },
    {
      label: '紧凑模式',
      hint: '压缩消息区和导航密度。',
      checked: uiSettings.density === 'compact',
      onChange: (checked: boolean) => onUpdateUi({ density: checked ? 'compact' : 'comfortable' }),
    },
  ];
  return (
    <>
      <div className="settings-section-head"><h3>显示</h3></div>
      <section className="studio-settings-panel workbench-display-panel">
        <div className="settings-option-list">
          {rows.map((row) => (
            <label className="settings-option-row" key={row.label}>
              <span><strong>{row.label}</strong><small>{row.hint}</small></span>
              <input type="checkbox" checked={row.checked} onChange={(event) => row.onChange(event.target.checked)} />
            </label>
          ))}
        </div>
      </section>
    </>
  );
}

function TelemetrySettingsPanel({ uiSettings, status, onUpdateUi }: { uiSettings: WorkbenchUiSettings; status: TelemetryStatus | null; onUpdateUi: (next: Partial<WorkbenchUiSettings>) => void }) {
  return (
    <>
      <div className="settings-section-head"><h3>隐私</h3></div>
      <section className="studio-settings-panel telemetry-settings-panel">
        <label className="settings-option-row">
          <span>
            <strong>匿名使用统计</strong>
            <small>用于统计日活、月活、留存、功能结果和粗略地区分布。</small>
          </span>
          <input type="checkbox" checked={uiSettings.telemetryEnabled === true} onChange={(event) => onUpdateUi({ telemetryEnabled: event.target.checked, telemetryNoticeSeenAt: uiSettings.telemetryNoticeSeenAt || new Date().toISOString() })} />
        </label>
        <p>公网 IP 只由 Umami 换算为国家、省份和城市。不会发送对话、文件内容、项目名称、路径、密钥或账户资料。</p>
        <div className="telemetry-status-row">
          <span>{status?.configured ? 'Umami 已配置' : 'Umami 未配置'}</span>
          <span>待发送 {status?.queueSize || 0} 条</span>
          <span>{status?.lastSentAt ? `最近发送 ${formatTime(status.lastSentAt)}` : '尚未发送'}</span>
        </div>
      </section>
    </>
  );
}

function TelemetryNotice({ onAllow, onDecline }: { onAllow: () => void; onDecline: () => void }) {
  return (
    <aside className="telemetry-notice" role="status" aria-live="polite">
      <div>
        <strong>是否允许匿名使用统计？</strong>
        <p>同意后才会统计功能使用和粗略地区。不会发送对话、文件、项目名称、路径、密钥或账户资料。</p>
      </div>
      <div className="telemetry-notice-actions">
        <button className="secondary-btn" onClick={onDecline}>不发送</button>
        <button className="send-btn" onClick={onAllow}>同意</button>
      </div>
    </aside>
  );
}

function ArchivedThreadsPanel({ threads, onRefresh, onRestore, onDelete }: { threads: ThreadSummary[]; onRefresh: () => Promise<void>; onRestore: (threadId: string) => Promise<void>; onDelete: (threadId: string) => Promise<void> }) {
  async function restore(thread: ThreadSummary) {
    await onRestore(thread.id);
    await onRefresh();
  }
  async function remove(thread: ThreadSummary) {
    const ok = window.confirm(`删除对话「${thread.title}」？\n\n删除后不会进入归档。`);
    if (!ok) return;
    await onDelete(thread.id);
    await onRefresh();
  }
  return (
    <>
      <div className="settings-head"><h2>归档对话</h2></div>
      <section className="studio-settings-panel archived-threads-panel">
        {threads.length ? threads.map((thread) => (
          <div className="archived-thread-row" key={thread.id}>
            <div>
              <strong>{thread.title}</strong>
              <span>{thread.workspaceRootPath ? thread.workspaceRootPath : '单聊对话'} · {thread.archivedAt ? formatTime(thread.archivedAt) : formatTime(thread.updatedAt)}</span>
            </div>
            <button className="secondary-btn compact" onClick={() => void restore(thread)}>恢复</button>
            <button className="secondary-btn compact danger" onClick={() => void remove(thread)}>删除</button>
          </div>
        )) : <p className="muted-copy">暂无归档对话。</p>}
      </section>
    </>
  );
}

function UserProfilePanel({ userProfile, defaultAgent, onSaved }: { userProfile: UserProfile; defaultAgent: Agent | null; onSaved: (profile: UserProfile, agents?: Agent[]) => void }) {
  const [summary, setSummary] = useState<UserProfileSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [activityMode, setActivityMode] = useState<'daily' | 'weekly' | 'total'>('daily');
  const displayName = userProfile.nickname || 'Frakio User';
  const initials = (displayName || 'MG').slice(0, 2).toUpperCase();
  const stats = summary?.stats || { totalTokens: 0, peakDayTokens: 0, peakDay: '', requests: 0, conversations: 0, activeAgents: 0 };
  const activity = buildProfileActivity(summary?.usage?.byDay || [], summary?.usage?.entries || [], activityMode);
  const topAgents = (summary?.agents || []).filter((agent) => agent.conversationCount > 0 || agent.messageCount > 0).slice(0, 5);
  const topSkills = (summary?.modules.skills.byName || []).slice(0, 5);
  const topPlugins = (summary?.modules.plugins.byName || []).slice(0, 5);
  const skillRuns = topSkills.reduce((sum, item) => sum + moduleUsageTotal(item), 0);
  const pluginRuns = topPlugins.reduce((sum, item) => sum + moduleUsageTotal(item), 0);
  const insightRows = [
    { label: '对话总数', value: formatFullNumber(stats.conversations) },
    { label: '使用过的 Agent', value: formatFullNumber(stats.activeAgents) },
    { label: '模型请求', value: formatFullNumber(stats.requests) },
    { label: 'Skill 使用次数', value: formatFullNumber(skillRuns) },
    { label: '插件使用次数', value: formatFullNumber(pluginRuns) },
  ];

  async function loadSummary() {
    setLoading(true);
    try {
      const data = await fetch('/api/user-profile/summary').then((res) => res.json());
      setSummary(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  function handleSaved(profile: UserProfile, agents?: Agent[]) {
    onSaved(profile, agents);
    setEditOpen(false);
    void loadSummary();
  }

  return (
    <section className="profile-dashboard">
      <div className="profile-dashboard-actions">
        <button className="secondary-btn compact" onClick={() => setEditOpen(true)}><Pencil size={14} />编辑</button>
      </div>
      <section className="profile-hero">
        <button className="profile-avatar-button" onClick={() => setEditOpen(true)} aria-label="编辑个人资料">
          {userProfile.avatarUrl ? <img src={userProfile.avatarUrl} alt="" /> : initials}
        </button>
        <h2>{displayName}</h2>
        <p>Frakio Work 用户 · 默认 Agent：{defaultAgent?.name || '未设置'}</p>
        {loading && <span className="profile-loading">正在刷新资料数据...</span>}
      </section>

      <section className="profile-stat-strip" aria-label="个人统计">
        <div><strong>{formatChineseApproxNumber(stats.totalTokens)}</strong><span>累计 Token 数</span></div>
        <div><strong>{formatChineseApproxNumber(stats.peakDayTokens)}</strong><span>峰值日 Token 数</span></div>
        <div><strong>{formatFullNumber(stats.requests)}</strong><span>模型请求</span></div>
        <div><strong>{formatFullNumber(stats.conversations)}</strong><span>对话数</span></div>
        <div><strong>{formatFullNumber(stats.activeAgents)}</strong><span>使用过的 Agent</span></div>
      </section>

      <section className="profile-activity-panel">
        <div className="profile-section-head">
          <h3>Token 活动</h3>
          <div className="mini-segment">
            <button className={activityMode === 'daily' ? 'selected' : ''} onClick={() => setActivityMode('daily')}>每日</button>
            <button className={activityMode === 'weekly' ? 'selected' : ''} onClick={() => setActivityMode('weekly')}>每周</button>
            <button className={activityMode === 'total' ? 'selected' : ''} onClick={() => setActivityMode('total')}>累计</button>
          </div>
        </div>
        <div className="token-activity-scroll">
          <div className="token-activity-grid" aria-label="Token 活动网格">
            {activity.cells.map((cell) => <span className={`level-${cell.level}`} key={cell.day} title={`${cell.day} · ${formatFullNumber(cell.value)} tokens`} />)}
          </div>
          <div className="token-activity-months">{activity.months.map((month) => <span key={`${month.label}-${month.index}`} style={{ gridColumnStart: month.index + 1 }}>{month.label}</span>)}</div>
        </div>
      </section>

      <section className="profile-lower-grid">
        <ProfileInsightPanel title="活动洞察" empty="暂无活动记录。">
          <div className="profile-metric-list">
            {insightRows.map((row) => <div key={row.label}><span>{row.label}</span><strong>{row.value}</strong></div>)}
          </div>
        </ProfileInsightPanel>
        <section className="profile-insight-panel profile-top-list">
          <h3>最常用</h3>
          <div className="profile-top-section">
            <h4>Agent</h4>
            <div className="profile-insight-list">
              {topAgents.length ? topAgents.map((agent) => (
                <div className="profile-agent-row" key={agent.id}>
                  <span className="profile-agent-avatar" style={agent.avatarUrl ? undefined : { background: agent.color || '#0f766e' }}>{agent.avatarUrl ? <img src={agent.avatarUrl} alt="" /> : agent.name.slice(0, 1).toUpperCase()}</span>
                  <span><strong>{agent.name}</strong><small>{agent.role || agent.profileName || 'Agent'}</small></span>
                  <em>{agent.conversationCount} 次对话<small>{agent.messageCount} 条消息</small></em>
                </div>
              )) : <p className="muted-copy">暂无 Agent 使用记录。</p>}
            </div>
          </div>
          <div className="profile-top-section">
            <h4>Skill</h4>
            <div className="profile-insight-list">
              {topSkills.length ? topSkills.map((item) => <ProfileModuleUsageRow item={item} key={item.name} />) : <p className="muted-copy">暂无 Skill 使用记录。</p>}
            </div>
          </div>
          <div className="profile-top-section">
            <h4>插件</h4>
            <div className="profile-insight-list">
              {topPlugins.length ? topPlugins.map((item) => <ProfileModuleUsageRow item={item} key={item.name} />) : <p className="muted-copy">暂无插件使用记录。</p>}
            </div>
          </div>
        </section>
      </section>

      {editOpen && (
        <div className="modal-backdrop profile-edit-modal">
          <div className="modal-card profile-edit-card">
            <button className="profile-edit-close icon-btn" onClick={() => setEditOpen(false)} aria-label="关闭"><X size={18} /></button>
            <UserProfileForm userProfile={userProfile} defaultAgent={defaultAgent} onSaved={handleSaved} onCancel={() => setEditOpen(false)} compact />
          </div>
        </div>
      )}
    </section>
  );
}

function ProfileInsightPanel({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const hasChildren = React.Children.count(children) > 0;
  return (
    <section className="profile-insight-panel">
      <h3>{title}</h3>
      <div className="profile-insight-list">
        {hasChildren ? children : <p className="muted-copy">{empty}</p>}
      </div>
    </section>
  );
}

function ProfileModuleUsageRow({ item }: { item: UserProfileModuleUsage }) {
  const total = moduleUsageTotal(item);
  return (
    <div className="profile-module-row">
      <span><strong>{item.name}</strong><small>{item.enabledProfiles ?? 0}/{item.profiles ?? 0} enabled</small></span>
      <em>{formatFullNumber(total)} 次<small>{item.lastUsedAt ? formatTime(item.lastUsedAt) : '暂无最近记录'}</small></em>
    </div>
  );
}

function moduleUsageTotal(item: UserProfileModuleUsage) {
  return Number(item.useCount || 0) + Number(item.viewCount || 0) + Number(item.patchCount || 0);
}

function buildProfileActivity(days: UsageDay[], entries: UsageEntry[], mode: 'daily' | 'weekly' | 'total') {
  const byDay = new Map<string, number>();
  for (const row of days || []) {
    const day = String(row.day || '').slice(0, 10);
    if (day) byDay.set(day, Number(row.realTotalTokens || row.totalTokens || 0));
  }
  if (!byDay.size) {
    for (const entry of entries || []) {
      const day = String(entry.createdAt || '').slice(0, 10);
      if (day) byDay.set(day, (byDay.get(day) || 0) + Number(entry.realTotalTokens || entry.totalTokens || 0));
    }
  }

  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(start.getDate() - 370);
  start.setDate(start.getDate() - start.getDay());

  const rawCells: Array<{ day: string; value: number; week: number; date: Date }> = [];
  for (let index = 0; index < 371; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const day = date.toISOString().slice(0, 10);
    rawCells.push({ day, value: byDay.get(day) || 0, week: Math.floor(index / 7), date });
  }

  const weekTotals = rawCells.reduce((map, cell) => map.set(cell.week, (map.get(cell.week) || 0) + cell.value), new Map<number, number>());
  let running = 0;
  const modeValues = rawCells.map((cell) => {
    if (mode === 'weekly') return weekTotals.get(cell.week) || 0;
    if (mode === 'total') {
      running += cell.value;
      return running;
    }
    return cell.value;
  });
  const maxValue = Math.max(1, ...modeValues);
  const cells = rawCells.map((cell, index) => ({
    day: cell.day,
    value: modeValues[index],
    level: activityLevel(modeValues[index], maxValue),
  }));
  const months: Array<{ label: string; index: number }> = [];
  let lastMonth = '';
  for (const cell of rawCells) {
    const month = `${cell.date.getFullYear()}-${cell.date.getMonth()}`;
    if (month !== lastMonth && cell.date.getDate() <= 7) {
      months.push({ label: `${cell.date.getMonth() + 1}月`, index: cell.week + 1 });
      lastMonth = month;
    }
  }
  return { cells, months: months.slice(-13) };
}

function activityLevel(value: number, maxValue: number) {
  if (value <= 0) return 0;
  const ratio = value / maxValue;
  if (ratio > .75) return 4;
  if (ratio > .45) return 3;
  if (ratio > .18) return 2;
  return 1;
}

function UserProfileForm({ userProfile, defaultAgent, onSaved, onCancel, compact = false }: { userProfile: UserProfile; defaultAgent: Agent | null; onSaved: (profile: UserProfile, agents?: Agent[]) => void; onCancel?: () => void; compact?: boolean }) {
  const [draft, setDraft] = useState<UserProfile>(userProfile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => setDraft(userProfile), [userProfile.updatedAt, userProfile.avatarUrl, userProfile.nickname]);
  const formName = String(draft.nickname || userProfile.nickname || 'Frakio User').trim();
  const formInitials = (formName || 'MG').slice(0, 2).toUpperCase();

  function chooseAvatar(file: File | undefined) {
    if (!file) return;
    setError('');
    setAvatarCropFile(file);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  }

  async function uploadAvatar(data: string) {
    setAvatarSaving(true);
    try {
      const res = await fetch('/api/user-profile/avatar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mimeType: 'image/png', data }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '头像保存失败。');
      setDraft((current) => ({ ...current, avatarUrl: payload.avatarUrl || '' }));
      setAvatarCropFile(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : '头像保存失败。');
    } finally {
      setAvatarSaving(false);
    }
  }

  async function saveProfile() {
    setSaving(true);
    setError('');
    try {
      const res = await fetch('/api/user-profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userProfile: draft }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '用户资料保存失败。');
      onSaved(payload.userProfile, payload.agents);
    } catch (err) {
      setError(err instanceof Error ? err.message : '用户资料保存失败。');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={compact ? 'user-profile-form compact' : 'user-profile-form'}>
      <div className="user-profile-edit-hero">
        <button className="user-profile-avatar" type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarSaving} aria-label="上传用户头像">
          {draft.avatarUrl ? <img src={draft.avatarUrl} alt="" /> : formInitials}
        </button>
        <input ref={avatarInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => chooseAvatar(event.target.files?.[0])} />
        <div>
          <span>编辑个人资料</span>
          <strong>{formName}</strong>
          <small>默认 Agent：{defaultAgent?.name || '未设置'} · 资料会同步给 Agent 使用</small>
          <button className="profile-avatar-upload-link" type="button" onClick={() => avatarInputRef.current?.click()} disabled={avatarSaving}>{avatarSaving ? '上传中...' : draft.avatarUrl ? '更换头像' : '上传头像'}</button>
        </div>
      </div>
      <div className="preference-grid user-profile-grid">
        <label>用户名/昵称<input value={draft.nickname} onChange={(event) => setDraft({ ...draft, nickname: event.target.value })} placeholder="例如：Alex" /></label>
        <label>年龄<input value={draft.age} onChange={(event) => setDraft({ ...draft, age: event.target.value })} placeholder="选填" /></label>
        <label className="wide">个人简介<textarea value={draft.bio} onChange={(event) => setDraft({ ...draft, bio: event.target.value })} placeholder="简单介绍你自己" /></label>
        <label className="wide">爱好<textarea value={draft.hobbies} onChange={(event) => setDraft({ ...draft, hobbies: event.target.value })} placeholder="选填" /></label>
        <label className="wide">职业信息<textarea value={draft.occupation} onChange={(event) => setDraft({ ...draft, occupation: event.target.value })} placeholder="选填" /></label>
        <label>默认 Agent 对你的称呼<input value={draft.defaultAgentAddress} onChange={(event) => setDraft({ ...draft, defaultAgentAddress: event.target.value })} placeholder="例如：老板" /></label>
        <label>其他 Agent 对你的称呼<input value={draft.otherAgentAddress} onChange={(event) => setDraft({ ...draft, otherAgentAddress: event.target.value })} placeholder="例如：Alex" /></label>
      </div>
      {error && <div className="form-error">{error}</div>}
      <div className="modal-actions">
        {onCancel && <button className="secondary-btn" onClick={onCancel} disabled={saving || avatarSaving}>取消</button>}
        <button className="send-btn" onClick={() => void saveProfile()} disabled={saving || avatarSaving}>{saving ? '保存中' : '保存并同步到 Agent'}</button>
      </div>
      {avatarCropFile && <AvatarCropModal file={avatarCropFile} title="裁剪个人头像" saving={avatarSaving} onCancel={() => setAvatarCropFile(null)} onSave={(data) => void uploadAvatar(data)} />}
    </div>
  );
}

function AvatarCropModal({ file, title, saving, onCancel, onSave }: { file: File; title: string; saving: boolean; onCancel: () => void; onSave: (dataUrl: string) => void }) {
  const [imageUrl, setImageUrl] = useState('');
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState<{ pointerId: number; x: number; y: number; offsetX: number; offsetY: number } | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setImageUrl(url);
    setScale(1);
    setOffset({ x: 0, y: 0 });
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function imageMetrics() {
    const image = imageRef.current;
    const frame = frameRef.current;
    if (!image || !frame) return null;
    const size = frame.clientWidth || 280;
    const naturalWidth = image.naturalWidth || 1;
    const naturalHeight = image.naturalHeight || 1;
    const baseScale = Math.max(size / naturalWidth, size / naturalHeight);
    const drawWidth = naturalWidth * baseScale * scale;
    const drawHeight = naturalHeight * baseScale * scale;
    return { size, drawWidth, drawHeight };
  }

  function clampOffset(next: { x: number; y: number }) {
    const metrics = imageMetrics();
    if (!metrics) return next;
    const maxX = Math.max(0, (metrics.drawWidth - metrics.size) / 2);
    const maxY = Math.max(0, (metrics.drawHeight - metrics.size) / 2);
    return { x: Math.min(maxX, Math.max(-maxX, next.x)), y: Math.min(maxY, Math.max(-maxY, next.y)) };
  }

  function saveCroppedAvatar() {
    const image = imageRef.current;
    const metrics = imageMetrics();
    if (!image || !metrics) return;
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 512;
    const context = canvas.getContext('2d');
    if (!context) return;
    const ratio = 512 / metrics.size;
    const drawWidth = metrics.drawWidth * ratio;
    const drawHeight = metrics.drawHeight * ratio;
    context.clearRect(0, 0, 512, 512);
    context.drawImage(image, (512 - drawWidth) / 2 + offset.x * ratio, (512 - drawHeight) / 2 + offset.y * ratio, drawWidth, drawHeight);
    onSave(canvas.toDataURL('image/png'));
  }

  return (
    <div className="modal-backdrop nested" onClick={onCancel}>
      <div className="modal avatar-crop-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><h2>{title}</h2><p>拖动位置，放大后保存为圆形安全区。</p></div>
          <button className="icon-btn" onClick={onCancel} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="avatar-crop-body">
          <div
            className="avatar-crop-frame"
            ref={frameRef}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              setDragStart({ pointerId: event.pointerId, x: event.clientX, y: event.clientY, offsetX: offset.x, offsetY: offset.y });
            }}
            onPointerMove={(event) => {
              if (!dragStart || dragStart.pointerId !== event.pointerId) return;
              setOffset(clampOffset({ x: dragStart.offsetX + event.clientX - dragStart.x, y: dragStart.offsetY + event.clientY - dragStart.y }));
            }}
            onPointerUp={() => setDragStart(null)}
            onPointerCancel={() => setDragStart(null)}
          >
            {imageUrl && <img ref={imageRef} src={imageUrl} alt="" style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }} onLoad={() => setOffset((current) => clampOffset(current))} draggable={false} />}
          </div>
          <label className="avatar-crop-slider">
            <span>缩放</span>
            <input type="range" min="1" max="2.6" step="0.01" value={scale} onChange={(event) => {
              setScale(Number(event.target.value));
              window.requestAnimationFrame(() => setOffset((current) => clampOffset(current)));
            }} />
          </label>
          <div className="modal-actions">
            <button className="secondary-btn" onClick={onCancel} disabled={saving}>取消</button>
            <button className="send-btn" onClick={saveCroppedAvatar} disabled={saving}>{saving ? '保存中' : '保存头像'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function HermesRuntimePanel({ runtime, bootstrap, localStatus, diagnostics, apiAvailability, onStart, onRefresh }: { runtime: HermesRuntimeStatus | null; bootstrap: HermesBootstrapStatus | null; localStatus: HermesLocalStatus | null; diagnostics: HermesRuntimeDiagnostics | null; apiAvailability: HermesApiAvailability; onStart: () => Promise<void>; onRefresh: () => Promise<unknown> }) {
  const bridgeReady = Boolean(runtime?.bridge?.ready);
  const bundledRuntimeReady = Boolean(runtime?.runtime?.runtimeDir || diagnostics?.runtime?.runtimeDir);
  const workbenchApiOnline = Boolean(bootstrap?.api?.online);
  const runtimeUnavailable = apiAvailability === 'offline';
  const autoStart = runtime?.autoStart;
  const runtimeTools = runtime?.tools || diagnostics?.tools || {};
  const missingRuntimeTools = Object.values(runtimeTools).filter((tool) => tool && !tool.available).map((tool) => tool.command);
  const autoStartLabel = autoStart?.status === 'starting' ? '自动启动中' : autoStart?.status === 'ready' ? '自动启动已就绪' : autoStart?.status === 'partial' ? '自动启动部分失败' : autoStart?.status === 'failed' ? '自动启动失败' : '等待自动启动';
  return (
    <section className="studio-settings-panel hermes-runtime-panel">
      <div className="studio-toolbar">
        <div>
          <h3>Hermes Runtime</h3>
        </div>
        <div className="runtime-actions">
          <button className="secondary-btn" onClick={() => void onRefresh()}>重新检测</button>
          <button className="send-btn" onClick={() => void onStart()}>{bridgeReady || workbenchApiOnline ? '重新启动 Runtime' : '启动 Runtime'}</button>
        </div>
      </div>
      <div className={`runtime-autostart ${autoStart?.status || 'idle'}`}>
        <div>
          <strong>{autoStartLabel}</strong>
          <span>{autoStart?.finishedAt ? `最近完成 ${formatTime(autoStart.finishedAt)}` : autoStart?.startedAt ? `开始于 ${formatTime(autoStart.startedAt)}` : '本地管理服务启动后会自动检测 Bridge、Runtime API 和 Profile Gateway。'}</span>
        </div>
        {autoStart?.steps?.length ? (
          <div className="runtime-autostart-steps">
            {autoStart.steps.map((step) => <span className={step.status} key={step.id}>{step.label}</span>)}
          </div>
        ) : null}
        {autoStart?.error && <em>{autoStart.error}</em>}
      </div>
      <div className="runtime-status-grid">
        <div className={bundledRuntimeReady ? 'runtime-status-card connected' : 'runtime-status-card'}>
          <span>Frakio Work 内置 Runtime</span>
          <strong>{bundledRuntimeReady ? '可用' : '未打包'}</strong>
          <small>{runtime?.runtime?.runtimeDir || diagnostics?.runtime?.runtimeDir || '等待检测'}</small>
        </div>
        <div className={workbenchApiOnline ? 'runtime-status-card connected' : 'runtime-status-card'}>
          <span>Frakio Work Runtime API</span>
          <strong>{workbenchApiOnline ? '运行中' : runtimeUnavailable ? '本地管理服务未运行' : 'OpenAI-compatible Runtime API 未启动'}</strong>
          <small>{bootstrap?.api?.apiBaseUrl || 'http://127.0.0.1:8642/v1'}</small>
        </div>
        <div className={bridgeReady ? 'runtime-status-card connected' : 'runtime-status-card'}>
          <span>聊天运行桥接</span>
          <strong>{bridgeReady ? '运行中' : '桥接未就绪'}</strong>
          <small>{runtime?.bridge?.endpoint || '等待检测'}</small>
          {runtime?.bridge?.error && <em>{runtime.bridge.error}</em>}
        </div>
        <div className="runtime-status-card">
          <span>Hermes Home</span>
          <strong>{runtime?.hermesHome || '~/.hermes'}</strong>
          <small>官方配置、Profile 和模型凭据</small>
        </div>
        <div className="runtime-status-card">
          <span>Frakio Work Home</span>
          <strong>{runtime?.frakioWorkHome || diagnostics?.frakioWorkHome?.path || '~/.frakio-work'}</strong>
          <small>{runtime?.agentRoot ? `运行 Runtime · ${runtime.agentRoot}` : '派生 API home、bridge socket 和 runtime 文件'}</small>
        </div>
        <div className={missingRuntimeTools.length ? 'runtime-status-card' : 'runtime-status-card connected'}>
          <span>Runtime Tools</span>
          <strong>{missingRuntimeTools.length ? `缺少 ${missingRuntimeTools.join(', ')}` : '依赖可用'}</strong>
          <small>{['node', 'npm', 'npx', 'uv', 'python3'].map((name) => `${name}:${runtimeTools[name]?.available ? 'ok' : 'missing'}`).join(' · ')}</small>
        </div>
      </div>
      {diagnostics && <div className="runtime-diagnostics">
        <span><strong>管理服务</strong>{diagnostics.workbenchApi.url} · PID {diagnostics.workbenchApi.pid}</span>
        <span><strong>Hermes Home</strong>{diagnostics.hermesHome.path} · {diagnostics.hermesHome.profileCount} profiles</span>
        <span><strong>Frakio Work Home</strong>{diagnostics.frakioWorkHome?.path || '~/.frakio-work'}</span>
        <span><strong>运行 Runtime</strong>{diagnostics.agentRoot.path || '未定位'}</span>
        <span><strong>Bridge Script</strong>{diagnostics.bridgeScript.path || '未定位'}</span>
        <span><strong>Python</strong>{diagnostics.python.path || '未定位'}</span>
        <span><strong>Runtime Tools</strong>{['node', 'npm', 'npx', 'uv', 'python3'].map((name) => diagnostics.tools?.[name]?.path || `${name}: missing`).join(' · ')}</span>
      </div>}
      <p className="runtime-panel-note">Profile Gateway 状态与操作已合并到 Agent 配置的 Agent 卡片中。</p>
    </section>
  );
}

function UpdatesPanel({ runtime, status, busy, error, result, onCheck, onCheckRuntime, onInstallRuntime, onActivateRuntime, onUseBundledRuntime, onDeleteRuntime, onUpdateFrakioWork }: {
  runtime: HermesRuntimeStatus | null;
  status: UpdatesStatus | null;
  busy: UpdateBusy;
  error: string;
  result: UpdateActionResult | null;
  onCheck: () => Promise<void>;
  onCheckRuntime: () => Promise<void>;
  onInstallRuntime: () => Promise<void>;
  onActivateRuntime: (version: string) => Promise<void>;
  onUseBundledRuntime: () => Promise<void>;
  onDeleteRuntime: (version: string) => Promise<void>;
  onUpdateFrakioWork: () => Promise<void>;
}) {
  const manager = runtime?.manager;
  const active = manager?.activeRuntime || runtime?.runtime || null;
  const bundled = manager?.bundledRuntime || null;
  const latest = manager?.officialLatest || null;
  const managed = manager?.managedRuntimes || [];
  const latestBundled = Boolean(latest?.version && bundled?.version === latest.version);
  const latestInstalled = Boolean(latest?.version && (latestBundled || managed.some((item) => item.version === latest.version)));
  return (
    <section className="updates-panel">
      <div className="runtime-panel-head">
        <div>
          <h3>版本与更新</h3>
          <p>Hermes Agent Runtime 与 Frakio Work 分开更新。内置 Runtime 始终保留。</p>
        </div>
        <button className="secondary-btn" onClick={() => void Promise.all([onCheck(), onCheckRuntime()])} disabled={Boolean(busy)}>{busy === 'check' || busy === 'runtime-check' ? '检查中' : '检查更新'}</button>
      </div>
      <div className="updates-grid">
        <div className="update-card runtime-update-card">
          <div className="update-card-head">
            <span><strong>Hermes Agent Runtime</strong><small>由 Frakio Work 独立管理，不依赖 Hermes Studio 或其他 Web UI。</small></span>
            <em>{active?.source === 'managed' ? '用户安装' : active?.source === 'override' ? '开发覆盖' : 'Frakio Work 内置'}</em>
          </div>
          <div className="update-meta">
            <span><strong>当前版本</strong>{active?.version || '未知'}</span>
            <span><strong>内置版本</strong>{bundled?.version || '未知'}</span>
            <span><strong>官方稳定版</strong>{latest?.label || latest?.tag || '等待检查'}</span>
            <span><strong>运行路径</strong>{active?.runtimeDir || '未定位'}</span>
          </div>
          {manager?.fallbackReason && <div className="update-blocked">{manager.fallbackReason}</div>}
          <div className="runtime-version-actions">
            <button className="secondary-btn" onClick={() => void onInstallRuntime()} disabled={Boolean(busy) || latestInstalled || !latest?.tag}>{busy === 'runtime-install' ? '安装中' : latestBundled ? '最新版本已内置' : latestInstalled ? '最新版本已安装' : '下载安装'}</button>
            {active?.source === 'managed' && <button className="secondary-btn" onClick={() => void onUseBundledRuntime()} disabled={Boolean(busy)}>{busy === 'runtime-bundled' ? '切换中' : '恢复内置版本'}</button>}
          </div>
          {managed.length > 0 && <div className="runtime-version-list">
            {managed.map((item) => {
              const isActive = active?.source === 'managed' && active.version === item.version;
              return <div className="runtime-version-row" key={`${item.version}-${item.platform}`}>
                <span><strong>{item.version}</strong><small>{item.manifest?.sourceTag || item.platform || ''}{item.compatible === false ? ' · Bridge 不兼容' : ''}</small></span>
                <div>
                  <button className="secondary-btn" onClick={() => void onActivateRuntime(item.version || '')} disabled={Boolean(busy) || isActive || item.compatible === false}>{busy === `runtime-activate:${item.version}` ? '切换中' : isActive ? '正在使用' : '使用'}</button>
                  <button className="icon-btn" aria-label={`删除 Runtime ${item.version}`} title="删除这个用户 Runtime" onClick={() => void onDeleteRuntime(item.version || '')} disabled={Boolean(busy) || isActive}><Trash2 size={15} /></button>
                </div>
              </div>;
            })}
          </div>}
          {manager?.sourcePath && <small className="update-remote">源码缓存（可删除后重新下载）：{manager.sourcePath}</small>}
        </div>
        <UpdateModuleCard
          title="Frakio Work"
          description="更新桌面应用、Web UI、API、Frakio Bridge 和下一版内置 Runtime。"
          status={status?.frakioWork || null}
          busy={busy === 'frakio-work'}
          onUpdate={onUpdateFrakioWork}
          primaryLabel="更新"
        />
      </div>
      {error && <div className="form-error">{error}</div>}
      {result?.logs?.length ? <div className="updates-log"><strong>{result.target || 'update'} · {result.phase || 'status'}</strong><span>{result.logs.slice(-3).join(' · ')}</span>{result.backup?.path && <em>回滚点：{result.backup.path}</em>}{result.restartRequired && <em>更新已完成，重启当前 Frakio Work 服务后生效。</em>}</div> : null}
    </section>
  );
}

function UpdateModuleCard({ title, description, status, busy, onUpdate, primaryLabel }: { title: string; description: string; status: UpdateModuleStatus | null; busy: boolean; onUpdate: () => Promise<void>; primaryLabel: string }) {
  if (status?.release) {
    const release = status.release;
    const canOpen = Boolean(release.releaseUrl);
    return (
      <div className={`update-card ${release.updateAvailable ? 'available' : ''}`}>
        <div className="update-card-head">
          <span><strong>{title}</strong><small>{description}</small></span>
          <em>{release.updateAvailable ? '有可用更新' : release.latestVersion ? '已是最新' : '等待首个 Release'}</em>
        </div>
        <div className="update-meta">
          <span><strong>当前版本</strong>v{release.currentVersion}</span>
          <span><strong>最新版本</strong>{release.latestVersion ? `v${release.latestVersion}` : '尚未发布'}</span>
          <span><strong>安装方式</strong>{release.installMode === 'desktop-release' ? 'macOS 安装包' : '源码版'}</span>
          <span><strong>当前架构</strong>{release.asset?.name || '使用 Release 升级说明'}</span>
        </div>
        {release.notes && <p className="update-release-notes">{release.notes.slice(0, 280)}</p>}
        {release.error && <div className="update-blocked">{release.error}</div>}
        <button className="secondary-btn" onClick={() => void onUpdate()} disabled={!canOpen || busy}>{busy ? '打开中' : release.installMode === 'desktop-release' && release.asset ? '下载新版' : '查看 Release'}</button>
      </div>
    );
  }
  const shortCurrent = shortCommit(status?.currentCommit);
  const shortUpstream = shortCommit(status?.upstreamCommit);
  const blocked = status?.blockedReason || '';
  const canUpdate = Boolean(status?.isGitRepo && status.updateAvailable && status.canFastForward && status.installKind !== 'external');
  const stateLabel = !status ? '等待检测' : !status.isGitRepo ? '不可自动更新' : status.installKind === 'external' ? '第三方安装' : blocked ? '需要处理' : status.updateAvailable ? '有可用更新' : '已是最新';
  return (
    <div className={`update-card ${canUpdate ? 'available' : blocked ? 'blocked' : ''}`}>
      <div className="update-card-head">
        <span><strong>{title}</strong><small>{description}</small></span>
        <em>{stateLabel}</em>
      </div>
      <div className="update-meta">
        <span><strong>当前版本</strong>{status?.displayVersion || status?.packageVersion || shortCurrent || '未知'}</span>
        {status?.latestVersion && <span><strong>最新版本</strong>{status.latestVersion}</span>}
        <span><strong>技术信息</strong>{shortCurrent || '未知'}{status?.currentBranch ? ` · ${status.currentBranch}` : ''}{status?.currentTagDescription ? ` · ${status.currentTagDescription}` : ''}</span>
        <span><strong>远端</strong>{shortUpstream || '未知'}</span>
        <span><strong>路径</strong>{status?.path || '等待检测'}</span>
      </div>
      {status?.remoteUrl && <small className="update-remote">{status.remoteUrl}</small>}
      {blocked && <div className="update-blocked">{blocked}</div>}
      {status?.dirtyFiles?.length ? <div className="update-dirty">{status.dirtyFiles.slice(0, 6).map((file) => <code key={file}>{file}</code>)}</div> : null}
      {status?.installKind === 'external' && <div className="update-blocked">检测到非官方 origin。自动恢复和回滚需要先接管此 Hermes checkout。</div>}
      <button className="secondary-btn" onClick={() => void onUpdate()} disabled={!canUpdate || busy}>{busy ? '更新中' : primaryLabel}</button>
    </div>
  );
}

function HermesBackupRow({ backup, busy, onRollback, onDelete }: { backup: HermesBackup; busy: UpdateBusy; onRollback: (backup: HermesBackup, scopes: RollbackScopes) => Promise<void>; onDelete: (backup: HermesBackup) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [scopes, setScopes] = useState<RollbackScopes>({});
  const rollbackBusy = busy === `rollback:${backup.id}`;
  const deleteBusy = busy === `delete:${backup.id}`;
  const before = backup.before?.displayVersion || backup.before?.tagDescription || shortCommit(backup.before?.commit || '') || '未知版本';
  const after = backup.after?.displayVersion || backup.after?.tagDescription || shortCommit(backup.after?.commit || '') || '未记录';
  const content = [
    backup.patchSaved ? '本地 patch' : '',
    backup.untrackedFiles?.length ? `${backup.untrackedFiles.length} 个未跟踪文件` : '',
    backup.configFiles?.length ? `${backup.configFiles.length} 个配置文件` : '',
  ].filter(Boolean).join(' · ') || '配置快照';
  return (
    <details className="backup-row" open={open} onToggle={(event) => setOpen((event.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span><strong>{backupReasonLabel(backup.reason)}</strong><small>{formatTime(backup.createdAt)} · {before} → {after}</small></span>
        <em>{formatFileSize(backup.size || 0)}</em>
      </summary>
      <div className="backup-row-body">
        <div className="backup-meta">
          <span><strong>路径</strong>{backup.path}</span>
          <span><strong>内容</strong>{content}</span>
          <span><strong>状态</strong>{backup.status || 'ready'}</span>
        </div>
        {backup.dirtyFiles?.length ? <div className="update-dirty">{backup.dirtyFiles.slice(0, 8).map((file) => <code key={file}>{file}</code>)}</div> : null}
        <div className="rollback-scopes">
          <span>回滚配置范围</span>
          <label><input type="checkbox" checked={scopes.profiles === true} onChange={(event) => setScopes((current) => ({ ...current, profiles: event.target.checked }))} /> Profiles</label>
          <label><input type="checkbox" checked={scopes.mcp === true} onChange={(event) => setScopes((current) => ({ ...current, mcp: event.target.checked }))} /> MCP</label>
          <label><input type="checkbox" checked={scopes.channels === true} onChange={(event) => setScopes((current) => ({ ...current, channels: event.target.checked }))} /> 频道</label>
          <label><input type="checkbox" checked={scopes.models === true} onChange={(event) => setScopes((current) => ({ ...current, models: event.target.checked }))} /> 模型</label>
        </div>
        <div className="backup-actions">
          <button className="secondary-btn" onClick={() => void onRollback(backup, scopes)} disabled={rollbackBusy || Boolean(busy && !rollbackBusy)}>{rollbackBusy ? '回滚中' : '回滚到此版本'}</button>
          <button className="secondary-btn danger" onClick={() => void onDelete(backup)} disabled={deleteBusy || Boolean(busy && !deleteBusy)}>{deleteBusy ? '删除中' : '删除备份'}</button>
        </div>
      </div>
    </details>
  );
}

function backupReasonLabel(reason?: string) {
  if (reason === 'update') return '更新前回滚点';
  if (reason === 'pre-rollback') return '回滚前快照';
  if (reason === 'manual') return '手动备份';
  return reason || '备份';
}

function shortCommit(value?: string) {
  return value ? value.slice(0, 7) : '';
}

type SettingsSection = 'hermes' | 'agents' | 'profile' | 'workbench' | 'archivedThreads' | 'mcp' | 'models' | 'channels' | 'plugins' | 'jobs' | 'monitoring' | 'vaults';

const settingsGroups: Array<{ title: string; items: Array<{ id: SettingsSection; label: string; icon: React.ComponentType<{ size?: number }> }> }> = [
  { title: '个人', items: [{ id: 'profile', label: '个人资料', icon: UserCircle }, { id: 'workbench', label: '工作台', icon: PanelRight }, { id: 'archivedThreads', label: '归档对话', icon: Archive }] },
  { title: '本地 Hermes', items: [{ id: 'hermes', label: '本地 Hermes', icon: Sparkles }, { id: 'agents', label: 'Agent 配置', icon: Network }, { id: 'models', label: '模型', icon: Bot }] },
  { title: '集成', items: [{ id: 'mcp', label: 'MCP', icon: Boxes }, { id: 'channels', label: '频道', icon: MessageSquare }, { id: 'plugins', label: '插件', icon: Boxes }] },
  { title: '编码', items: [{ id: 'jobs', label: '任务', icon: Clock3 }, { id: 'monitoring', label: '监控', icon: Activity }] },
  { title: '仓库', items: [{ id: 'vaults', label: '仓库', icon: Database }] },
];

function SettingsRail({ activeSection, onSectionChange, onReturnToConversation }: { activeSection: SettingsSection; onSectionChange: (section: SettingsSection) => void; onReturnToConversation: () => void }) {
  const [settingsQuery, setSettingsQuery] = useState('');
  const normalizedSettingsQuery = settingsQuery.trim().toLowerCase();
  const visibleSettingsGroups = settingsGroups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !normalizedSettingsQuery || `${group.title} ${item.label}`.toLowerCase().includes(normalizedSettingsQuery)),
    }))
    .filter((group) => group.items.length > 0);

  return (
    <aside className="settings-rail-sidebar">
      <button className="settings-return" onClick={onReturnToConversation}><ArrowLeft size={16} /><span>返回对话</span></button>
      <label className="settings-search">
        <Search size={15} />
        <input value={settingsQuery} onChange={(event) => setSettingsQuery(event.target.value)} placeholder="搜索设置..." />
      </label>
      <div className="settings-nav">
        {visibleSettingsGroups.map((group) => (
          <section className="settings-nav-group" key={group.title}>
            <span>{group.title}</span>
            {group.items.map((item) => {
              const Icon = item.icon;
              return (
                <button className={activeSection === item.id ? 'selected' : ''} key={item.id} onClick={() => onSectionChange(item.id)}>
                  <Icon size={16} />
                  <strong>{item.label}</strong>
                </button>
              );
            })}
          </section>
        ))}
      </div>
    </aside>
  );
}

function SettingsPage({ vaults, models, agents, hermesStatus, hermesBootstrap, hermesRuntime, hermesDiagnostics, hermesApiAvailability, hermesError, updatesStatus, updatesBusy, updatesError, updatesResult, onCheckUpdates, onUpdateHermesAgent, onUpdateFrakioWork, onCheckHermesRuntime, onInstallHermesRuntime, onActivateHermesRuntime, onUseBundledHermesRuntime, onDeleteHermesRuntime, onCreateHermesBackup, onRollbackHermesBackup, onDeleteHermesBackup, onCleanupHermesBackups, userProfile, uiSettings, telemetryStatus, isImportingHermes, vaultPathInput, setVaultPathInput, vaultError, vaultBusy, addVault, reindexVault, deleteVault, onImportHermes, onRunFirstUseGuide, firstUseGuideRunning, onStartHermesRuntime, onRefreshHermesRuntime, onStartProfileGateway, onUpdateUi, onUserProfileSaved, pinnedNav, onTogglePinned, modelError, saveModel, deleteModel, fetchAvailableModels, activeSection, archivedThreads, onRefreshArchivedThreads, onRestoreThread, onDeleteThread, selectedOrgAgentId, onSelectAgent, onProfilesChanged, onUpdateAgent, onDeleteAgent, onCreateAgent, profileEditor, onUpdateDefaultAgent }: {
  vaults: Vault[];
  models: ModelProfile[];
  agents: Agent[];
  hermesStatus: HermesLocalStatus | null;
  hermesBootstrap: HermesBootstrapStatus | null;
  hermesRuntime: HermesRuntimeStatus | null;
  hermesDiagnostics: HermesRuntimeDiagnostics | null;
  hermesApiAvailability: HermesApiAvailability;
  hermesError: string;
  updatesStatus: UpdatesStatus | null;
  updatesBusy: UpdateBusy;
  updatesError: string;
  updatesResult: UpdateActionResult | null;
  onCheckUpdates: () => Promise<void>;
  onUpdateHermesAgent: () => Promise<void>;
  onUpdateFrakioWork: () => Promise<void>;
  onCheckHermesRuntime: () => Promise<void>;
  onInstallHermesRuntime: () => Promise<void>;
  onActivateHermesRuntime: (version: string) => Promise<void>;
  onUseBundledHermesRuntime: () => Promise<void>;
  onDeleteHermesRuntime: (version: string) => Promise<void>;
  onCreateHermesBackup: () => Promise<void>;
  onRollbackHermesBackup: (backup: HermesBackup, scopes: RollbackScopes) => Promise<void>;
  onDeleteHermesBackup: (backup: HermesBackup) => Promise<void>;
  onCleanupHermesBackups: (mode: 'older-than-30-days' | 'keep-latest-10') => Promise<void>;
  userProfile: UserProfile;
  uiSettings: WorkbenchUiSettings;
  telemetryStatus: TelemetryStatus | null;
  isImportingHermes: boolean;
  vaultPathInput: string;
  setVaultPathInput: (value: string) => void;
  vaultError: string;
  vaultBusy: Record<string, 'index' | 'delete'>;
  addVault: () => Promise<void>;
  reindexVault: (vaultId: string) => Promise<void>;
  deleteVault: (vault: Vault) => Promise<void>;
  onImportHermes: () => Promise<void>;
  onRunFirstUseGuide: () => void;
  firstUseGuideRunning: boolean;
  onStartHermesRuntime: () => Promise<void>;
  onRefreshHermesRuntime: () => Promise<unknown>;
  onStartProfileGateway: (profileName: string) => Promise<void>;
  onUpdateUi: (next: Partial<WorkbenchUiSettings>) => void;
  onUserProfileSaved: (profile: UserProfile, agents?: Agent[]) => void;
  pinnedNav: PinnedNav;
  onTogglePinned: (id: string) => void;
  modelError: string;
  saveModel: (payload: ModelPayload, modelId?: string) => Promise<boolean>;
  deleteModel: (modelId: string) => Promise<boolean>;
  fetchAvailableModels: (baseUrl: string, apiKey: string) => Promise<string[]>;
  activeSection: SettingsSection;
  archivedThreads: ThreadSummary[];
  onRefreshArchivedThreads: () => Promise<void>;
  onRestoreThread: (threadId: string) => Promise<void>;
  onDeleteThread: (threadId: string) => Promise<void>;
  selectedOrgAgentId: string;
  onSelectAgent: (id: string) => void;
  onProfilesChanged: () => Promise<void>;
  onUpdateAgent: (agentId: string, payload: Partial<Agent>) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
  onCreateAgent: () => void;
  profileEditor: ProfileEditorControls;
  onUpdateDefaultAgent: (agentId: string) => void;
}) {
  const localProfiles = hermesBootstrap?.profiles.length ? hermesBootstrap.profiles : hermesStatus?.profiles || [];
  const detectedProfiles = localProfiles.length;
  const hermesPath = hermesBootstrap?.installPath || hermesStatus?.profiles?.[0]?.path?.replace(/\/profiles\/[^/]+$/, '') || '~/.hermes';
  const canSyncHermes = detectedProfiles > 0;
  const workbenchApiOffline = hermesApiAvailability === 'offline';
  const localHermesTitle = workbenchApiOffline ? 'Frakio Work 本地管理服务未运行' : canSyncHermes ? '已发现本地 Hermes 配置' : '未发现本地 Hermes 配置';
  const frakioHome = hermesRuntime?.frakioWorkHome || hermesDiagnostics?.frakioWorkHome?.path || '~/.frakio-work';
  const localHermesDetail = workbenchApiOffline ? '无法连接 127.0.0.1:8787，前端无法检测或启动本地 Hermes runtime。' : `Hermes Home ${hermesPath} · Frakio Work Home ${frakioHome} · ${detectedProfiles} 个 Profile · 模型需在 Frakio Work 单独配置`;
  const localHermesHint = workbenchApiOffline
    ? '请用 npm run dev 同时启动 Web 和 API，或单独运行 npm run dev:api。'
    : hermesBootstrap?.checkedAt || hermesStatus?.checkedAt
      ? `最近检测 ${formatTime(hermesBootstrap?.checkedAt || hermesStatus?.checkedAt || '')}`
      : '打开设置时会自动检测本地配置。';
  const defaultAgent = agents.find((agent) => agent.id === uiSettings.defaultAgentId) || agents.find((agent) => agent.id === 'iris') || agents[0] || null;
  const defaultAgentProfile = resolveHermesProfileNameForAgent(defaultAgent, localProfiles);
  return (
    <section className="settings-page codex-settings-page">
      <div className="settings-content">
          {activeSection === 'hermes' && <>
            <div className="settings-head"><h2>本地 Hermes 设置</h2></div>
            <div className="local-hermes-card">
              <div className="local-hermes-main">
                <div className={workbenchApiOffline ? 'bootstrap-badge error' : canSyncHermes ? 'bootstrap-badge connected' : 'bootstrap-badge missing'}><Sparkles size={16} /></div>
                <div>
                  <strong>{localHermesTitle}</strong>
                  <span>{localHermesDetail}</span>
                  <small>{localHermesHint}</small>
                </div>
              </div>
              <div className="local-hermes-actions">
                <button className="secondary-btn" onClick={onRunFirstUseGuide} disabled={firstUseGuideRunning}>{firstUseGuideRunning ? '引导运行中' : '初次使用引导'}</button>
                <button className="send-btn" onClick={() => void onImportHermes()} disabled={isImportingHermes || !canSyncHermes}>{isImportingHermes ? '同步中' : '同步本地 Hermes 设置'}</button>
              </div>
            </div>
            {hermesError && <div className="form-error">{hermesError}</div>}
            <HermesRuntimePanel runtime={hermesRuntime} bootstrap={hermesBootstrap} localStatus={hermesStatus} diagnostics={hermesDiagnostics} apiAvailability={hermesApiAvailability} onStart={onStartHermesRuntime} onRefresh={onRefreshHermesRuntime} />
            <UpdatesPanel runtime={hermesRuntime} status={updatesStatus} busy={updatesBusy} error={updatesError} result={updatesResult} onCheck={onCheckUpdates} onCheckRuntime={onCheckHermesRuntime} onInstallRuntime={onInstallHermesRuntime} onActivateRuntime={onActivateHermesRuntime} onUseBundledRuntime={onUseBundledHermesRuntime} onDeleteRuntime={onDeleteHermesRuntime} onUpdateFrakioWork={onUpdateFrakioWork} />
          </>}

          {activeSection === 'agents' && (
            <OrgPage
              agents={agents}
              models={models}
              hermesRuntime={hermesRuntime}
              selectedOrgAgentId={selectedOrgAgentId}
              onSelectAgent={onSelectAgent}
              onProfilesChanged={onProfilesChanged}
              onUpdateAgent={onUpdateAgent}
              onDeleteAgent={onDeleteAgent}
              onCreate={onCreateAgent}
              profileEditor={profileEditor}
              defaultAgentId={uiSettings.defaultAgentId || defaultAgent?.id || ''}
              onUpdateDefaultAgent={onUpdateDefaultAgent}
              onRefreshHermesRuntime={onRefreshHermesRuntime}
              onStartProfileGateway={onStartProfileGateway}
            />
          )}

          {activeSection === 'profile' && (
            <UserProfilePanel
              userProfile={userProfile}
              defaultAgent={defaultAgent}
              onSaved={onUserProfileSaved}
            />
          )}

          {activeSection === 'workbench' && <>
            <div className="settings-head"><h2>工作台</h2></div>
            <TelemetrySettingsPanel uiSettings={uiSettings} status={telemetryStatus} onUpdateUi={onUpdateUi} />
            <WorkbenchDisplaySettings uiSettings={uiSettings} onUpdateUi={onUpdateUi} />
            <div className="settings-section-head spaced"><h3>工作台偏好</h3></div>
            <div className="preference-grid">
              <label className="wide">新对话标语<input value={uiSettings.newChatPrompt || '我们接下来做点什么？'} onChange={(event) => onUpdateUi({ newChatPrompt: event.target.value })} /></label>
              <label>发送键<select value={uiSettings.sendKey || 'enter'} onChange={(event) => onUpdateUi({ sendKey: event.target.value as WorkbenchUiSettings['sendKey'] })}><option value="enter">Enter 发送</option><option value="mod-enter">Cmd/Ctrl + Enter 发送</option></select></label>
              <label>默认操作权限<select value={uiSettings.defaultPermissionMode || 'manual'} onChange={(event) => onUpdateUi({ defaultPermissionMode: event.target.value as PermissionMode })}>{(['manual', 'smart', 'off'] as const).map((mode) => <option key={mode} value={mode}>{permissionLabel(mode)}</option>)}</select></label>
              <label>上下文压缩阈值<input type="number" value={uiSettings.contextTriggerTokens || 500000} onChange={(event) => onUpdateUi({ contextTriggerTokens: Number(event.target.value) })} /></label>
              <label>群聊触发 Token<input type="number" value={uiSettings.groupChatTriggerTokens || 100000} onChange={(event) => onUpdateUi({ groupChatTriggerTokens: Number(event.target.value) })} /></label>
              <label>历史尾部消息数<input type="number" value={uiSettings.historyTailMessages || 10} onChange={(event) => onUpdateUi({ historyTailMessages: Number(event.target.value) })} /></label>
            </div>
            <div className="settings-section-head"><h3>左侧置顶</h3></div>
            <div className="pin-grid">
              {railNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <button className={pinnedNav[item.id] === false ? 'pin-card' : 'pin-card active'} key={item.id} onClick={() => onTogglePinned(item.id)}>
                    <Icon size={16} />
                    <span>{item.label}</span>
                    <CheckCircle2 size={16} />
                  </button>
                );
              })}
            </div>
          </>}

          {activeSection === 'models' && <ModelCenter models={models} profiles={localProfiles} defaultProfile={defaultAgentProfile || uiSettings.defaultProfile || 'default'} modelError={modelError} saveModel={saveModel} deleteModel={deleteModel} fetchAvailableModels={fetchAvailableModels} />}
          {activeSection === 'archivedThreads' && <ArchivedThreadsPanel threads={archivedThreads} onRefresh={onRefreshArchivedThreads} onRestore={onRestoreThread} onDelete={onDeleteThread} />}
          {activeSection === 'mcp' && <McpSettingsPage profiles={localProfiles} defaultProfile={defaultAgentProfile || uiSettings.defaultProfile || hermesBootstrap?.approval.profileName || 'default'} />}
          {activeSection === 'channels' && <ChannelsPage profiles={localProfiles} defaultProfile={defaultAgentProfile || uiSettings.defaultProfile || hermesBootstrap?.approval.profileName || 'default'} embedded />}
          {activeSection === 'plugins' && <PluginsPage agents={agents} profiles={localProfiles} embedded />}
          {activeSection === 'jobs' && <JobsPage profiles={localProfiles} defaultProfile={defaultAgentProfile || uiSettings.defaultProfile || hermesBootstrap?.approval.profileName || 'default'} embedded />}
          {activeSection === 'monitoring' && <MonitoringPage embedded />}
          {activeSection === 'vaults' && <>
            <div className="settings-head"><h2>Obsidian 仓库</h2></div>
            <div className="vault-form">
              <input value={vaultPathInput} onChange={(event) => setVaultPathInput(event.target.value)} placeholder="/Users/.../你的 Obsidian 仓库" />
              <button className="send-btn" onClick={() => void addVault()}>检测并添加</button>
            </div>
            {vaultError && <div className="form-error">{vaultError}</div>}
            <div className="vault-table">
              {vaults.map((vault) => (
                <div className="vault-row" key={vault.id}>
                  <div><strong>{vault.name}</strong><span>{vault.path}</span></div>
                  <div><strong>{vault.documentCount}</strong><span>Markdown</span></div>
                  <div><strong>{vault.productCount}</strong><span>产品文档</span></div>
                  <div><strong>{vault.lastIndexedAt ? formatTime(vault.lastIndexedAt) : '尚未索引'}</strong><span>{vault.needsRefresh ? '建议更新' : vault.status === 'not_indexed' ? '未建立索引' : '已建立索引'}</span></div>
                  <div className="vault-row-actions">
                    <button className="secondary-btn" onClick={() => void reindexVault(vault.id)} disabled={Boolean(vaultBusy[vault.id])}><RefreshCw className={vaultBusy[vault.id] === 'index' ? 'spin' : ''} size={15} />{vaultBusy[vault.id] === 'index' ? '更新中' : '更新索引'}</button>
                    <button className="icon-btn small danger vault-delete-btn" onClick={() => void deleteVault(vault)} disabled={Boolean(vaultBusy[vault.id])} aria-label={`删除仓库 ${vault.name}`} title="移除仓库连接"><Trash2 size={15} /></button>
                  </div>
                </div>
              ))}
            </div>
          </>}
      </div>
    </section>
  );
}

function HermesModuleMatrix({ agents, profiles }: { agents: Agent[]; profiles: HermesProfile[] }) {
  const [mode, setMode] = useState<'skills' | 'plugins'>('skills');
  const rows = profiles.length
    ? profiles.map((profile) => ({
      id: profile.name,
      name: profile.displayName || profile.name,
      color: profileColor(profile.name),
      source: profile.path || profile.name,
      skills: profile.skills || [],
      plugins: profile.plugins || [],
    }))
    : agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      color: agent.color,
      source: agent.profileName || agent.source || 'manual',
      skills: agent.skills || [],
      plugins: agent.plugins || [],
    }));
  return (
    <div className="module-matrix">
      <div className="module-matrix-tabs">
        <button className={mode === 'skills' ? 'selected' : ''} onClick={() => setMode('skills')}>技能</button>
        <button className={mode === 'plugins' ? 'selected' : ''} onClick={() => setMode('plugins')}>插件</button>
      </div>
      <div className="module-matrix-list">
        {rows.map((row) => {
          const items = mode === 'skills' ? row.skills : row.plugins;
          const enabledCount = items.filter((item) => moduleEntryEnabled(item) || moduleEntryStatus(item) === 'enabled').length;
          return (
            <div className="module-matrix-row" key={row.id}>
              <div><span className="node-dot" style={{ background: row.color }} /><strong>{row.name}</strong><small>{row.source}</small></div>
              <div>
                {items.length ? <strong className="module-count">{enabledCount}/{items.length} 已启用</strong> : <em>未配置{mode === 'skills' ? '技能' : '插件'}</em>}
                {items.length ? items.slice(0, 12).map((item) => (
                  <span className={moduleEntryEnabled(item) || moduleEntryStatus(item) === 'enabled' ? 'enabled' : 'disabled'} key={moduleEntryName(item)}>
                    {moduleEntryName(item)}
                  </span>
                )) : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type PluginCenterFilter = 'all' | 'enabled' | 'disabled' | 'global' | 'profile';
type AggregatedPlugin = {
  name: string;
  sources: string[];
  files: string[];
  installedProfiles: string[];
  enabledProfiles: string[];
  categories: string[];
  useCount: number;
  viewCount: number;
  patchCount: number;
  lastUsedAt: string | null;
};

function PluginsPage({ agents, profiles, embedded = false }: { agents: Agent[]; profiles: HermesProfile[]; embedded?: boolean }) {
  const [filter, setFilter] = useState<PluginCenterFilter>('all');
  const [query, setQuery] = useState('');
  const rows = profiles.length
    ? profiles.map((profile) => ({
      id: profile.name,
      name: profile.displayName || profile.name,
      source: profile.path || profile.name,
      plugins: profile.plugins || [],
    }))
    : agents.map((agent) => ({
      id: agent.id,
      name: agent.profileName || agent.name,
      source: agent.source || agent.profileName || agent.name,
      plugins: agent.plugins || [],
    }));
  const plugins = aggregatePlugins(rows);
  const enabledCount = plugins.filter((plugin) => plugin.enabledProfiles.length > 0).length;
  const globalCount = plugins.filter((plugin) => plugin.sources.includes('global')).length;
  const profileCount = plugins.filter((plugin) => plugin.sources.includes('profile')).length;
  const normalizedQuery = query.trim().toLowerCase();
  const filtered = plugins.filter((plugin) => {
    const enabled = plugin.enabledProfiles.length > 0;
    const matchesFilter =
      filter === 'all'
      || (filter === 'enabled' && enabled)
      || (filter === 'disabled' && !enabled)
      || (filter === 'global' && plugin.sources.includes('global'))
      || (filter === 'profile' && plugin.sources.includes('profile'));
    const haystack = [
      plugin.name,
      ...plugin.sources,
      ...plugin.files,
      ...plugin.installedProfiles,
      ...plugin.categories,
    ].join(' ').toLowerCase();
    return matchesFilter && (!normalizedQuery || haystack.includes(normalizedQuery));
  });
  return (
    <section className={embedded ? 'embedded-management-page plugins-page' : 'management-page plugins-page'}>
      <div className="studio-toolbar settings-head">
        <div><h2>插件中心</h2></div>
      </div>

      <div className="plugin-stats">
        <article><span>插件总数</span><strong>{plugins.length}</strong><small>同名插件已合并</small></article>
        <article><span>已启用</span><strong>{enabledCount}</strong><small>至少一个 Profile 启用</small></article>
        <article><span>全局插件</span><strong>{globalCount}</strong><small>来自 Hermes 全局目录</small></article>
        <article><span>本地 Profile</span><strong>{profileCount}</strong><small>来自 Profile 插件目录</small></article>
      </div>

      <div className="plugin-toolbar">
        <div className="plugin-filter">
          {([
            ['all', '全部'],
            ['enabled', '已启用'],
            ['disabled', '未启用'],
            ['global', '全局'],
            ['profile', '本地 Profile'],
          ] as const).map(([value, label]) => (
            <button className={filter === value ? 'selected' : ''} key={value} onClick={() => setFilter(value)}>{label}</button>
          ))}
        </div>
        <label className="plugin-search">
          <Search size={15} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索插件、来源、路径或 Profile" />
        </label>
      </div>

      {filtered.length ? (
        <div className="plugin-grid">
          {filtered.map((plugin) => {
            const enabled = plugin.enabledProfiles.length > 0;
            const usageTotal = plugin.useCount + plugin.viewCount + plugin.patchCount;
            return (
              <article className="plugin-card" key={plugin.name}>
                <div className="plugin-card-head">
                  <div>
                    <strong>{plugin.name}</strong>
                    <span>{plugin.sources.includes('global') ? 'global' : 'profile'} · {plugin.installedProfiles.length} profiles</span>
                  </div>
                  <em className={enabled ? 'enabled' : ''}>{enabled ? '已启用' : '未启用'}</em>
                </div>
                <div className="plugin-meta">
                  <span>启用 {plugin.enabledProfiles.length}/{plugin.installedProfiles.length}</span>
                  <span>使用 {formatCompactNumber(usageTotal)}</span>
                  {plugin.lastUsedAt && <span>最近 {formatTime(plugin.lastUsedAt)}</span>}
                </div>
                <p>{plugin.files[0] || '未提供插件清单路径'}</p>
                <div className="plugin-tags">
                  {plugin.sources.map((source) => <span key={source}>{source}</span>)}
                  {plugin.installedProfiles.slice(0, 5).map((profile) => <span key={profile}>{profile}</span>)}
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="empty-state">当前没有匹配的插件。</div>
      )}
    </section>
  );
}

function aggregatePlugins(rows: Array<{ id: string; name: string; source: string; plugins: ProfileModuleEntry[] }>) {
  const byName = new Map<string, AggregatedPlugin>();
  for (const row of rows) {
    for (const item of row.plugins || []) {
      const name = moduleEntryName(item);
      if (!name) continue;
      const usage = moduleEntryUsage(item);
      const source = moduleEntrySource(item) || 'profile';
      const file = typeof item === 'string' ? '' : item.file || '';
      const category = moduleEntryCategory(item);
      const enabled = moduleEntryEnabled(item) || moduleEntryStatus(item) === 'enabled';
      const current = byName.get(name) || {
        name,
        sources: [],
        files: [],
        installedProfiles: [],
        enabledProfiles: [],
        categories: [],
        useCount: 0,
        viewCount: 0,
        patchCount: 0,
        lastUsedAt: null,
      };
      if (!current.sources.includes(source)) current.sources.push(source);
      if (file && !current.files.includes(file)) current.files.push(file);
      if (category && !current.categories.includes(category)) current.categories.push(category);
      if (!current.installedProfiles.includes(row.name)) current.installedProfiles.push(row.name);
      if (enabled && !current.enabledProfiles.includes(row.name)) current.enabledProfiles.push(row.name);
      current.useCount += usage.useCount || 0;
      current.viewCount += usage.viewCount || 0;
      current.patchCount += usage.patchCount || 0;
      if (usage.lastUsedAt && (!current.lastUsedAt || usage.lastUsedAt.localeCompare(current.lastUsedAt) > 0)) current.lastUsedAt = usage.lastUsedAt;
      byName.set(name, current);
    }
  }
  return Array.from(byName.values()).sort((a, b) => {
    const scoreA = a.enabledProfiles.length * 1000 + a.useCount + a.viewCount + a.patchCount;
    const scoreB = b.enabledProfiles.length * 1000 + b.useCount + b.viewCount + b.patchCount;
    return scoreB - scoreA || a.name.localeCompare(b.name);
  });
}

function modelChoiceValue(model: ModelProfile, modelName = model.model) {
  return `${model.id}::${modelName || model.model}`;
}

function splitModelChoiceValue(value: string) {
  const separator = '::';
  if (!value.includes(separator)) return { modelId: value, modelName: '' };
  const [modelId, ...rest] = value.split(separator);
  return { modelId, modelName: rest.join(separator) };
}

function modelNamesForProvider(model: ModelProfile) {
  return Array.from(new Set([...(model.models || []), model.model].map((item) => String(item || '').trim()).filter(Boolean)));
}

function resolveModelChoice(value: string, models: ModelProfile[]) {
  const clean = String(value || '').trim();
  const { modelId, modelName } = splitModelChoiceValue(clean);
  const model = models.find((item) => item.id === modelId)
    || models.find((item) => [item.id, item.name, item.model].includes(clean))
    || models.find((item) => modelNamesForProvider(item).includes(modelName || clean));
  const resolvedName = modelName || (model && modelNamesForProvider(model).includes(clean) ? clean : model?.model) || '';
  return { model: model || null, modelName: resolvedName, value: model ? modelChoiceValue(model, resolvedName || model.model) : clean };
}

function ProviderModelPicker({ models, value, onChange, agentName = '', emptyLabel = '未配置模型', className = '', ariaLabel = '切换模型', title = '切换模型', allowDefault = false, usingDefault = false }: { models: ModelProfile[]; value: string; onChange: (value: string) => void; agentName?: string; emptyLabel?: string; className?: string; ariaLabel?: string; title?: string; allowDefault?: boolean; usingDefault?: boolean }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const providers = models.filter((model) => model.baseUrl && modelNamesForProvider(model).length);
  const selected = resolveModelChoice(value, providers);
  const selectedLabel = selected.modelName || selected.model?.model || emptyLabel;

  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div className={`provider-model-picker ${className}`} ref={rootRef}>
      <button type="button" className="provider-model-trigger" onClick={() => setOpen((current) => !current)} disabled={!providers.length} aria-label={ariaLabel} title={title}>
        {agentName && <span>{agentName}</span>}
        <strong>{selectedLabel}</strong>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="provider-model-menu">
          {allowDefault && (
            <button type="button" className={`provider-model-follow-default ${usingDefault ? 'selected' : ''}`} onClick={() => { onChange(''); setOpen(false); }}>
              <span>跟随 Agent 默认模型</span>
              <small>默认模型变化时同步更新</small>
            </button>
          )}
          {providers.length ? providers.map((provider) => (
            <section className="provider-model-group" key={provider.id}>
              <strong>{provider.name || provider.provider}</strong>
              <div>
                {modelNamesForProvider(provider).map((modelName) => {
                  const itemValue = modelChoiceValue(provider, modelName);
                  const selectedItem = selected.value === itemValue;
                  return (
                    <button type="button" className={selectedItem ? 'selected' : ''} key={itemValue} onClick={() => { onChange(itemValue); setOpen(false); }}>
                      {modelName}
                    </button>
                  );
                })}
              </div>
            </section>
          )) : <span className="provider-model-empty">{emptyLabel}</span>}
        </div>
      )}
    </div>
  );
}

type ModelSlotGroup = { provider: string; label: string; models: string[] };

function useModelSlotGroups(models: ModelProfile[]) {
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/model-providers/presets').then((res) => res.json()).then((data: { providers?: ProviderPreset[] }) => {
      if (!cancelled) setPresets(Array.isArray(data.providers) ? data.providers : []);
    }).catch(() => { if (!cancelled) setPresets([]); });
    return () => { cancelled = true; };
  }, []);
  return useMemo(() => {
    const groups = new Map<string, ModelSlotGroup>();
    for (const preset of presets) {
      if (!preset.value || preset.value.toLowerCase() === 'moa') continue;
      groups.set(preset.value, { provider: preset.value, label: preset.label || preset.value, models: [...(preset.models || [])] });
    }
    for (const model of models) {
      const matchedPreset = presets.find((preset) => preset.value === model.providerKey || (model.baseUrl && preset.baseUrl === model.baseUrl));
      const provider = model.providerKey || matchedPreset?.value || '';
      if (!provider || provider.toLowerCase() === 'moa') continue;
      const current = groups.get(provider) || { provider, label: provider.startsWith('custom:') ? (model.name || model.provider || provider) : (matchedPreset?.label || model.provider || model.name || provider), models: [] };
      current.models = Array.from(new Set([...current.models, ...modelNamesForProvider(model)]));
      groups.set(provider, current);
    }
    return Array.from(groups.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [models, presets]);
}

function ModelIdCombobox({ value, options, onChange, placeholder = '选择或输入模型 ID' }: { value: string; options: string[]; onChange: (value: string) => void; placeholder?: string }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const normalizedOptions = Array.from(new Set(options.map((item) => String(item || '').trim()).filter(Boolean)));
  const filteredOptions = normalizedOptions.filter((item) => !value.trim() || item.toLowerCase().includes(value.trim().toLowerCase()));
  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="model-id-combobox" ref={rootRef}>
      <div className="model-id-combobox-input">
        <input
          value={value}
          placeholder={placeholder}
          onFocus={() => setOpen(true)}
          onClick={() => setOpen(true)}
          onChange={(event) => { onChange(event.target.value); setOpen(true); }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setOpen(false);
            if (event.key === 'ArrowDown') setOpen(true);
            if (event.key === 'Enter' && open && filteredOptions.length === 1) {
              event.preventDefault();
              onChange(filteredOptions[0]);
              setOpen(false);
            }
          }}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
        />
        <button type="button" onClick={() => setOpen((current) => !current)} aria-label="展开模型列表"><ChevronDown size={15} /></button>
      </div>
      {open && (
        <div className="model-id-combobox-menu" role="listbox">
          {filteredOptions.length ? filteredOptions.map((item) => (
            <button type="button" className={item === value ? 'selected' : ''} key={item} onClick={() => { onChange(item); setOpen(false); }}>{item}</button>
          )) : <span>没有匹配项，可直接输入模型 ID</span>}
        </div>
      )}
    </div>
  );
}

function AuxiliaryModelsPanel({ profile, groups }: { profile: string; groups: ModelSlotGroup[] }) {
  const [tasks, setTasks] = useState<AuxiliaryModelTask[]>([]);
  const [auxiliary, setAuxiliary] = useState<AuxiliaryModelsConfig>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ task: AuxiliaryModelTask; settings: AuxiliaryModelSettings; extraBody: string } | null>(null);

  async function load() {
    if (!profile) return;
    setLoading(true);
    setError('');
    try {
      const data = await requestJson<{ tasks: AuxiliaryModelTask[]; auxiliary: AuxiliaryModelsConfig }>(`/api/hermes/config/auxiliary-models?profile=${encodeURIComponent(profile)}`);
      setTasks(data.tasks || []);
      setAuxiliary(data.auxiliary || {});
    } catch (err: any) {
      setError(err.message || '辅助模型配置读取失败');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [profile]);

  function openEditor(task: AuxiliaryModelTask) {
    const current = auxiliary[task.key] || {};
    setEditing({
      task,
      settings: {
        provider: current.provider || 'auto',
        model: current.model || '',
        timeout: current.timeout || task.default_timeout,
        download_timeout: task.key === 'vision' ? (current.download_timeout || task.default_download_timeout) : undefined,
      },
      extraBody: current.extra_body ? JSON.stringify(current.extra_body, null, 2) : '',
    });
  }

  async function persist(task: AuxiliaryModelTask, settings: AuxiliaryModelSettings) {
    setSaving(true);
    setError('');
    try {
      const data = await requestJson<{ auxiliary: AuxiliaryModelsConfig }>(`/api/hermes/config/auxiliary-models?profile=${encodeURIComponent(profile)}`, {
        method: 'PUT',
        body: JSON.stringify({ auxiliary: { [task.key]: settings } }),
      });
      setAuxiliary(data.auxiliary || {});
      setEditing(null);
    } catch (err: any) {
      setError(err.message || '辅助模型配置保存失败');
    } finally {
      setSaving(false);
    }
  }

  async function saveEditor() {
    if (!editing) return;
    let extraBody: Record<string, any> | undefined;
    if (editing.extraBody.trim()) {
      try {
        const parsed = JSON.parse(editing.extraBody);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error();
        extraBody = parsed;
      } catch {
        setError('Extra body 必须是 JSON 对象。');
        return;
      }
    }
    await persist(editing.task, { ...editing.settings, ...(extraBody ? { extra_body: extraBody } : {}) });
  }

  function configLabel(settings: AuxiliaryModelSettings = {}) {
    if (settings.base_url) return `自定义端点${settings.model ? ` / ${settings.model}` : ''}`;
    const provider = settings.provider || 'auto';
    if (provider === 'auto') return '自动';
    if (provider === 'main') return '主模型';
    return `${provider}${settings.model ? ` / ${settings.model}` : ''}`;
  }

  function timeoutLabel(task: AuxiliaryModelTask, settings: AuxiliaryModelSettings = {}) {
    const values = [`${settings.timeout || task.default_timeout || '-'}s`];
    if (task.key === 'vision') values.push(`下载 ${settings.download_timeout || task.default_download_timeout || '-'}s`);
    return values.join(' / ');
  }

  const editingGroup = groups.find((group) => group.provider === editing?.settings.provider);
  return (
    <section className="model-routing-panel">
      <div className="model-routing-head"><div><h3>辅助模型</h3><p>为压缩、视觉、审批、MCP 和后台维护等任务单独指定模型。</p></div><button className="secondary-btn" onClick={() => void load()} disabled={loading}>{loading ? '刷新中' : '刷新'}</button></div>
      {error && <div className="form-error">{error}</div>}
      <div className="model-routing-table auxiliary-routing-table">
        <div className="model-routing-row head"><span>任务</span><span>Provider / 默认模型</span><span>超时</span><span>操作</span></div>
        {tasks.map((task) => <div className="model-routing-row" key={task.key}><strong>{task.label}</strong><span className="mono-cell">{configLabel(auxiliary[task.key])}</span><span className="mono-cell">{timeoutLabel(task, auxiliary[task.key])}</span><span className="row-actions"><button onClick={() => openEditor(task)}>编辑</button><button disabled={saving} onClick={() => void persist(task, { provider: 'auto', timeout: task.default_timeout, ...(task.key === 'vision' ? { download_timeout: task.default_download_timeout } : {}) })}>清除</button></span></div>)}
      </div>
      {editing && <div className="modal-backdrop" onClick={() => !saving && setEditing(null)}><div className="modal model-routing-modal" onClick={(event) => event.stopPropagation()}><div className="modal-head"><div><h2>{editing.task.label}</h2><p>正在编辑 Profile：{profile}</p></div><button className="icon-btn" onClick={() => setEditing(null)}><X size={18} /></button></div><div className="routing-form-grid">
        <label>Provider<select value={editing.settings.provider || 'auto'} onChange={(event) => setEditing((current) => current ? { ...current, settings: { ...current.settings, provider: event.target.value, model: '' } } : current)}><option value="auto">自动</option><option value="main">主模型</option>{groups.map((group) => <option value={group.provider} key={group.provider}>{group.label}</option>)}</select></label>
        <label>模型{['auto', 'main'].includes(editing.settings.provider || 'auto')
          ? <span className="auxiliary-model-inherited">{editing.settings.provider === 'main' ? '直接使用当前 Agent 的主模型，无需另选模型。' : '由 Hermes 自动选择当前任务的模型，无需另选模型。'}</span>
          : <ModelIdCombobox value={editing.settings.model || ''} options={editingGroup?.models || []} onChange={(value) => setEditing((current) => current ? { ...current, settings: { ...current.settings, model: value } } : current)} />}</label>
        <label>调用超时（秒）<input type="number" min="1" value={editing.settings.timeout || ''} onChange={(event) => setEditing((current) => current ? { ...current, settings: { ...current.settings, timeout: Number(event.target.value) } } : current)} /></label>
        {editing.task.key === 'vision' && <label>下载超时（秒）<input type="number" min="1" value={editing.settings.download_timeout || ''} onChange={(event) => setEditing((current) => current ? { ...current, settings: { ...current.settings, download_timeout: Number(event.target.value) } } : current)} /></label>}
        <label className="wide-field">Extra body JSON<textarea rows={5} value={editing.extraBody} onChange={(event) => setEditing((current) => current ? { ...current, extraBody: event.target.value } : current)} /></label>
      </div><div className="modal-actions"><button className="secondary-btn" onClick={() => setEditing(null)}>取消</button><button className="send-btn" disabled={saving} onClick={() => void saveEditor()}>{saving ? '保存中' : '保存'}</button></div></div></div>}
    </section>
  );
}

function emptyMoaPreset(): MoaPreset {
  return { enabled: true, reference_models: [{ provider: '', model: '' }], aggregator: { provider: '', model: '' }, reference_temperature: null, aggregator_temperature: null, max_tokens: 4096, reference_max_tokens: null, fanout: 'per_iteration' };
}

function CombinationModelsPanel({ profile, groups }: { profile: string; groups: ModelSlotGroup[] }) {
  const [moa, setMoa] = useState<MoaConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ originalName: string; name: string; preset: MoaPreset } | null>(null);
  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

  async function load() {
    if (!profile) return;
    setLoading(true); setError('');
    try { setMoa(await requestJson<MoaConfig>(`/api/hermes/config/moa?profile=${encodeURIComponent(profile)}`)); }
    catch (err: any) { setError(err.message || '组合模型配置读取失败'); }
    finally { setLoading(false); }
  }
  useEffect(() => { void load(); }, [profile]);

  async function persist(next: MoaConfig) {
    setSaving(true); setError('');
    try {
      const data = await requestJson<{ moa: MoaConfig }>(`/api/hermes/config/moa?profile=${encodeURIComponent(profile)}`, { method: 'PUT', body: JSON.stringify({ moa: next }) });
      setMoa(data.moa); setEditing(null);
    } catch (err: any) { setError(err.message || '组合模型配置保存失败'); }
    finally { setSaving(false); }
  }

  function saveEditor() {
    if (!moa || !editing) return;
    const name = editing.name.trim();
    if (!/^[A-Za-z0-9_.-]{1,80}$/.test(name)) return setError('名称只能包含字母、数字、点、短横线和下划线。');
    if (name !== editing.originalName && moa.presets[name]) return setError('同名组合模型已经存在。');
    if (!editing.preset.reference_models.length || editing.preset.reference_models.some((slot) => !slot.provider || !slot.model)) return setError('至少需要一个完整的参考模型。');
    if (!editing.preset.aggregator.provider || !editing.preset.aggregator.model) return setError('请选择汇总模型。');
    const next = clone(moa);
    if (editing.originalName && editing.originalName !== name) {
      delete next.presets[editing.originalName];
      if (next.default_preset === editing.originalName) next.default_preset = name;
      if (next.active_preset === editing.originalName) next.active_preset = name;
    }
    next.presets[name] = clone(editing.preset);
    if (!next.default_preset) next.default_preset = name;
    void persist(next);
  }

  function updateSlot(kind: 'reference' | 'aggregator', index: number, field: keyof MoaModelSlot, value: string) {
    setEditing((current) => {
      if (!current) return current;
      const preset = clone(current.preset);
      const slot = kind === 'aggregator' ? preset.aggregator : preset.reference_models[index];
      slot[field] = value;
      if (field === 'provider') slot.model = '';
      return { ...current, preset };
    });
  }

  function modelOptions(provider: string) { return groups.find((group) => group.provider === provider)?.models || []; }
  const rows = Object.entries(moa?.presets || {});
  return <section className="model-routing-panel"><div className="model-routing-head"><div><h3>组合模型</h3><p>多个参考模型先给出视角，再由一个汇总模型负责最终回复和工具调用。</p></div><div className="top-actions"><button className="secondary-btn" onClick={() => void load()} disabled={loading}>{loading ? '刷新中' : '刷新'}</button><button className="send-btn" disabled={!moa} onClick={() => setEditing({ originalName: '', name: '', preset: emptyMoaPreset() })}>添加组合模型</button></div></div>
    {error && <div className="form-error">{error}</div>}
    <div className="model-routing-table combination-routing-table"><div className="model-routing-row head"><span>名称</span><span>参考模型</span><span>汇总模型</span><span>操作</span></div>{rows.map(([name, preset]) => <div className="model-routing-row" key={name}><strong>{name}{moa?.default_preset === name && <small className="default-badge">默认</small>}</strong><span className="mono-cell">{preset.reference_models.map((slot) => `${slot.provider} / ${slot.model}`).join(', ')}</span><span className="mono-cell">{preset.aggregator.provider} / {preset.aggregator.model}</span><span className="row-actions"><button onClick={() => setEditing({ originalName: name, name, preset: clone(preset) })}>编辑</button><button disabled={moa?.default_preset === name} onClick={() => { if (!moa) return; void persist({ ...clone(moa), default_preset: name }); }}>设为默认</button><button disabled={rows.length <= 1} onClick={() => { if (!moa || rows.length <= 1) return; const next = clone(moa); delete next.presets[name]; const fallback = Object.keys(next.presets)[0]; if (next.default_preset === name) next.default_preset = fallback; if (next.active_preset === name) next.active_preset = ''; void persist(next); }}>删除</button></span></div>)}</div>
    {editing && <div className="modal-backdrop" onClick={() => !saving && setEditing(null)}><div className="modal moa-editor-modal" onClick={(event) => event.stopPropagation()}><div className="modal-head"><div><h2>{editing.originalName ? '编辑组合模型' : '添加组合模型'}</h2><p>正在编辑 Profile：{profile}</p></div><button className="icon-btn" onClick={() => setEditing(null)}><X size={18} /></button></div><div className="routing-form-grid">
      <label>名称<input value={editing.name} onChange={(event) => setEditing((current) => current ? { ...current, name: event.target.value } : current)} placeholder="default" /></label><label className="toggle-field">启用<input type="checkbox" checked={editing.preset.enabled} onChange={(event) => setEditing((current) => current ? { ...current, preset: { ...current.preset, enabled: event.target.checked } } : current)} /></label>
      <label>参考温度<input type="number" step="0.1" value={editing.preset.reference_temperature ?? ''} onChange={(event) => setEditing((current) => current ? { ...current, preset: { ...current.preset, reference_temperature: event.target.value === '' ? null : Number(event.target.value) } } : current)} placeholder="Provider 默认" /></label><label>汇总温度<input type="number" step="0.1" value={editing.preset.aggregator_temperature ?? ''} onChange={(event) => setEditing((current) => current ? { ...current, preset: { ...current.preset, aggregator_temperature: event.target.value === '' ? null : Number(event.target.value) } } : current)} placeholder="Provider 默认" /></label>
      <label>最终输出上限<input type="number" min="1" value={editing.preset.max_tokens} onChange={(event) => setEditing((current) => current ? { ...current, preset: { ...current.preset, max_tokens: Number(event.target.value) } } : current)} /></label><label>单个参考输出上限<input type="number" min="1" value={editing.preset.reference_max_tokens ?? ''} onChange={(event) => setEditing((current) => current ? { ...current, preset: { ...current.preset, reference_max_tokens: event.target.value === '' ? null : Number(event.target.value) } } : current)} placeholder="不限制" /></label>
      <label>Fanout<select value={editing.preset.fanout} onChange={(event) => setEditing((current) => current ? { ...current, preset: { ...current.preset, fanout: event.target.value as MoaPreset['fanout'] } } : current)}><option value="per_iteration">每次工具迭代</option><option value="user_turn">每轮用户消息一次</option></select></label>
      <div className="slot-editor wide-field"><div className="slot-editor-head"><strong>参考模型</strong><button className="secondary-btn compact" onClick={() => setEditing((current) => current ? { ...current, preset: { ...current.preset, reference_models: [...current.preset.reference_models, { provider: '', model: '' }] } } : current)}>添加参考模型</button></div>{editing.preset.reference_models.map((slot, index) => <div className="slot-editor-row" key={index}><select value={slot.provider} onChange={(event) => updateSlot('reference', index, 'provider', event.target.value)}><option value="">选择 Provider</option>{groups.map((group) => <option value={group.provider} key={group.provider}>{group.label}</option>)}</select><input list={`moa-reference-models-${index}`} value={slot.model} onChange={(event) => updateSlot('reference', index, 'model', event.target.value)} disabled={!slot.provider} placeholder="选择或输入模型 ID" /><datalist id={`moa-reference-models-${index}`}>{modelOptions(slot.provider).map((model) => <option value={model} key={model} />)}</datalist><button className="icon-btn danger" disabled={editing.preset.reference_models.length <= 1} onClick={() => setEditing((current) => current ? { ...current, preset: { ...current.preset, reference_models: current.preset.reference_models.filter((_, itemIndex) => itemIndex !== index) } } : current)}><Trash2 size={15} /></button></div>)}</div>
      <div className="slot-editor wide-field"><div className="slot-editor-head"><strong>汇总模型</strong></div><div className="slot-editor-row"><select value={editing.preset.aggregator.provider} onChange={(event) => updateSlot('aggregator', 0, 'provider', event.target.value)}><option value="">选择 Provider</option>{groups.map((group) => <option value={group.provider} key={group.provider}>{group.label}</option>)}</select><input list="moa-aggregator-models" value={editing.preset.aggregator.model} onChange={(event) => updateSlot('aggregator', 0, 'model', event.target.value)} disabled={!editing.preset.aggregator.provider} placeholder="选择或输入模型 ID" /><datalist id="moa-aggregator-models">{modelOptions(editing.preset.aggregator.provider).map((model) => <option value={model} key={model} />)}</datalist></div></div>
    </div><div className="modal-actions"><button className="secondary-btn" onClick={() => setEditing(null)}>取消</button><button className="send-btn" disabled={saving} onClick={saveEditor}>{saving ? '保存中' : '保存'}</button></div></div></div>}
  </section>;
}

function ModelConfigPage({ models, profiles, defaultProfile, modelError, saveModel, deleteModel, fetchAvailableModels }: { models: ModelProfile[]; profiles: HermesProfile[]; defaultProfile: string; modelError: string; saveModel: (payload: ModelPayload, modelId?: string) => Promise<boolean>; deleteModel: (modelId: string) => Promise<boolean>; fetchAvailableModels: (baseUrl: string, apiKey: string) => Promise<string[]> }) {
  return (
    <section className="settings-page">
      <ModelCenter models={models} profiles={profiles} defaultProfile={defaultProfile} modelError={modelError} saveModel={saveModel} deleteModel={deleteModel} fetchAvailableModels={fetchAvailableModels} />
    </section>
  );
}

function ModelCenter({ models, profiles, defaultProfile, modelError, saveModel, deleteModel, fetchAvailableModels }: { models: ModelProfile[]; profiles: HermesProfile[]; defaultProfile: string; modelError: string; saveModel: (payload: ModelPayload, modelId?: string) => Promise<boolean>; deleteModel: (modelId: string) => Promise<boolean>; fetchAvailableModels: (baseUrl: string, apiKey: string) => Promise<string[]> }) {
  const [activeTab, setActiveTab] = useState<'general' | 'auxiliary' | 'combination'>('general');
  const [profile, setProfile] = useState(defaultProfile || profiles[0]?.name || 'default');
  const [editingModel, setEditingModel] = useState<ModelProfile | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const slotGroups = useModelSlotGroups(models);
  useEffect(() => { if (!profiles.some((item) => item.name === profile)) setProfile(defaultProfile || profiles[0]?.name || 'default'); }, [profiles.map((item) => item.name).join(','), defaultProfile]);
  async function handleSave(payload: ModelPayload) {
    const ok = await saveModel(payload, editingModel?.id);
    if (ok) {
      setModalOpen(false);
      setEditingModel(null);
    }
  }
  async function handleDelete(model: ModelProfile) {
    const okToDelete = window.confirm(`删除模型「${model.name}」？`);
    if (!okToDelete) return;
    await deleteModel(model.id);
  }
  return (
    <>
      <div className="model-center-head settings-head">
        <div><h2>模型</h2></div>
        <div className="top-actions">
          {activeTab !== 'general' && <label className="model-profile-select">Profile<select value={profile} onChange={(event) => setProfile(event.target.value)}>{profileOptions(profiles).map((item) => <option value={item.name} key={item.name}>{String((item as HermesProfile).displayName || item.name)}</option>)}</select></label>}
          {activeTab === 'general' && <button className="secondary-btn" onClick={() => { setEditingModel(null); setModalOpen(true); }}><Plus size={16} />添加模型</button>}
        </div>
      </div>
      <div className="module-matrix-tabs model-center-tabs"><button className={activeTab === 'general' ? 'selected' : ''} onClick={() => setActiveTab('general')}>通用模型</button><button className={activeTab === 'auxiliary' ? 'selected' : ''} onClick={() => setActiveTab('auxiliary')}>辅助模型</button><button className={activeTab === 'combination' ? 'selected' : ''} onClick={() => setActiveTab('combination')}>组合模型</button></div>
      {modelError && <div className="form-error">{modelError}</div>}
      {activeTab === 'auxiliary' ? <AuxiliaryModelsPanel profile={profile} groups={slotGroups} /> : activeTab === 'combination' ? <CombinationModelsPanel profile={profile} groups={slotGroups} /> : <div className="model-grid">
        {models.map((model) => (
          <div className="model-card" key={model.id} role="button" tabIndex={0} onClick={() => { setEditingModel(model); setModalOpen(true); }} onKeyDown={(event) => { if (event.key === 'Enter') { setEditingModel(model); setModalOpen(true); } }}>
            <div className="model-card-top">
              <span>{modelKindLabel(model.kind)}</span>
              <small>{model.hasApiKey ? '已配置 Key' : '未配置 Key'}</small>
              <button className="icon-btn small danger model-delete" onClick={(event) => { event.stopPropagation(); void handleDelete(model); }} aria-label={`删除 ${model.name}`}><Trash2 size={15} /></button>
            </div>
            <strong>{model.name}</strong>
            <p>Provider：{model.provider || '-'}</p>
            <p>Base URL：{model.baseUrl || '-'}</p>
            <p>模型列表：{model.models?.length || (model.model ? 1 : 0)} 个模型</p>
            <div className="model-tags model-tags-models">{(model.models?.length ? model.models : [model.model].filter(Boolean)).map((item) => <span key={item} className={item === model.model ? 'default' : ''}>{item}{item === model.model ? ' 默认' : ''}</span>)}</div>
          </div>
        ))}
        <button className="model-card add" onClick={() => { setEditingModel(null); setModalOpen(true); }}>
          <Plus size={22} />
          <strong>添加模型</strong>
          <p>官方 API / 第三方中转站 / 本地模型</p>
        </button>
      </div>}
      {modalOpen && <ModelEditorModal model={editingModel} onClose={() => { setModalOpen(false); setEditingModel(null); }} onSave={handleSave} fetchAvailableModels={fetchAvailableModels} />}
    </>
  );
}

function ModelEditorModal({ model, onClose, onSave, fetchAvailableModels }: { model: ModelProfile | null; onClose: () => void; onSave: (payload: ModelPayload) => Promise<void>; fetchAvailableModels: (baseUrl: string, apiKey: string) => Promise<string[]> }) {
  const emptyPricing: ModelPricing = { input: null, output: null, cacheRead: null, cacheCreation: null };
  const [providerType, setProviderType] = useState<'preset' | 'custom'>(model ? (model.providerKey && !model.providerKey.startsWith('custom:') ? 'preset' : 'custom') : 'preset');
  const [presets, setPresets] = useState<ProviderPreset[]>([]);
  const [selectedPreset, setSelectedPreset] = useState(model?.providerKey || '');
  const [providerQuery, setProviderQuery] = useState('');
  const [providerOpen, setProviderOpen] = useState(false);
  const [authType, setAuthType] = useState<ProviderAuthType | null>(null);
  const [authorizedProviders, setAuthorizedProviders] = useState<Record<string, boolean>>({});
  const [draft, setDraft] = useState<ModelPayload>({
    name: model?.name || '',
    provider: model?.provider || '',
    kind: model?.kind || 'official',
    protocol: model?.protocol || 'OpenAI Compatible',
    model: model?.model || '',
    models: model?.models?.length ? model.models : [model?.model || ''].filter(Boolean),
    baseUrl: model?.baseUrl || '',
    apiKey: '',
    providerKey: model?.providerKey || '',
    apiMode: model?.apiMode || 'chat_completions',
    contextLimit: model?.contextLimit || null,
    pricing: model?.pricing || emptyPricing,
  });
  const [availableModels, setAvailableModels] = useState<string[]>(model?.models?.length ? model.models : [model?.model || ''].filter(Boolean));
  const [fetchError, setFetchError] = useState('');
  const [isFetching, setIsFetching] = useState(false);
  const selectedPresetData = presets.find((preset) => preset.value === selectedPreset) || null;
  const selectedAuthType = selectedPresetData?.authType || null;
  const filteredPresets = presets.filter((preset) => `${preset.label} ${preset.value}`.toLowerCase().includes(providerQuery.toLowerCase().trim()));
  const canFetchModels = Boolean(draft.baseUrl && !selectedAuthType && /^https?:\/\//i.test(draft.baseUrl));
  const fetchModelsVisible = providerType === 'custom' || canFetchModels;
  const fetchModelsDisabled = isFetching || !draft.baseUrl || !draft.apiKey || !/^https?:\/\//i.test(draft.baseUrl);
  const hasUsableApiKey = Boolean(draft.apiKey || model?.hasApiKey || selectedAuthType);

  useEffect(() => {
    const nextProviderType = model ? (model.providerKey && !model.providerKey.startsWith('custom:') ? 'preset' : 'custom') : 'preset';
    setProviderType(nextProviderType);
    setSelectedPreset(model?.providerKey || '');
    setProviderQuery('');
    setAvailableModels(model?.models?.length ? model.models : [model?.model || ''].filter(Boolean));
    setDraft({
      name: model?.name || '',
      provider: model?.provider || '',
      kind: model?.kind || 'official',
      protocol: model?.protocol || 'OpenAI Compatible',
      model: model?.model || '',
      models: model?.models?.length ? model.models : [model?.model || ''].filter(Boolean),
      baseUrl: model?.baseUrl || '',
      apiKey: '',
      providerKey: model?.providerKey || '',
      apiMode: model?.apiMode || 'chat_completions',
      contextLimit: model?.contextLimit || null,
      pricing: model?.pricing || emptyPricing,
    });
  }, [model?.id]);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/model-providers/presets')
      .then((res) => res.json())
      .then((data: { providers?: ProviderPreset[] }) => {
        if (cancelled) return;
        const nextPresets = Array.isArray(data.providers) ? data.providers : [];
        setPresets(nextPresets);
        const current = nextPresets.find((preset) => preset.value === model?.providerKey);
        if (current) setProviderQuery(current.label);
      })
      .catch(() => {
        if (!cancelled) setPresets([]);
      });
    return () => { cancelled = true; };
  }, [model?.providerKey]);

  function protocolFromApiMode(apiMode?: ProviderApiMode): ModelProtocol {
    if (apiMode === 'anthropic_messages') return 'Anthropic Compatible';
    if (apiMode === 'codex_responses' || apiMode === 'chat_completions') return 'OpenAI Compatible';
    return apiMode ? 'Custom' : 'OpenAI Compatible';
  }
  function kindFromPreset(preset: ProviderPreset): ModelKind {
    if (preset.value === 'lmstudio') return 'local';
    if (preset.value.includes('fun') || preset.value.includes('gateway') || preset.value.includes('router')) return 'relay';
    return 'official';
  }
  function autoNameFromBaseUrl(baseUrl: string) {
    const clean = baseUrl.trim().replace(/^https?:\/\//, '').replace(/\/v\d+\/?$/i, '');
    const host = clean.split('/')[0];
    if (!host) return '';
    if (host.includes('localhost') || host.includes('127.0.0.1')) return `Local ${host}`;
    return host.charAt(0).toUpperCase() + host.slice(1);
  }
  function applyPreset(providerKey: string) {
    const preset = presets.find((item) => item.value === providerKey);
    setSelectedPreset(providerKey);
    setProviderOpen(false);
    setFetchError('');
    if (!preset) return;
    const nextModels = preset.models || [];
    setProviderQuery(preset.label);
    setAvailableModels(nextModels);
    setDraft((current) => ({
      ...current,
      name: preset.label,
      provider: preset.label,
      providerKey: preset.value,
      apiMode: preset.apiMode || 'chat_completions',
      protocol: protocolFromApiMode(preset.apiMode || 'chat_completions'),
      kind: kindFromPreset(preset),
      baseUrl: preset.baseUrl,
      model: nextModels[0] || '',
      models: nextModels,
    }));
  }
  function resetForProviderType(nextType: 'preset' | 'custom') {
    setProviderType(nextType);
    setSelectedPreset('');
    setProviderQuery('');
    setProviderOpen(false);
    setAvailableModels([]);
    setFetchError('');
    setDraft({
      name: '',
      provider: nextType === 'preset' ? '' : 'Custom',
      kind: 'official',
      protocol: 'OpenAI Compatible',
      model: '',
      models: [],
      baseUrl: '',
      apiKey: '',
      providerKey: '',
      apiMode: 'chat_completions',
      contextLimit: null,
      pricing: emptyPricing,
    });
  }
  function updateCustomBaseUrl(baseUrl: string) {
    setDraft((current) => ({
      ...current,
      baseUrl,
      name: current.name || autoNameFromBaseUrl(baseUrl),
    }));
  }
  async function handleFetchModels() {
    setFetchError('');
    if (!draft.baseUrl || !draft.apiKey || !/^https?:\/\//i.test(draft.baseUrl)) {
      setFetchError('请先填写有效的 Base URL 和 API Key。');
      return;
    }
    setIsFetching(true);
    try {
      let nextModels: string[];
      if (draft.providerKey || draft.apiMode) {
        const res = await fetch('/api/model-providers/fetch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: draft.providerKey, label: draft.provider, baseUrl: draft.baseUrl, apiKey: draft.apiKey, apiMode: draft.apiMode }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '模型列表获取失败。');
        nextModels = data.models as string[];
      } else {
        nextModels = await fetchAvailableModels(draft.baseUrl, draft.apiKey);
      }
      setAvailableModels(nextModels);
      if (nextModels[0]) setDraft((current) => ({ ...current, models: nextModels, model: nextModels.includes(current.model) ? current.model : nextModels[0] }));
    } catch (error) {
      setFetchError(error instanceof Error ? error.message : '模型列表获取失败。');
    } finally {
      setIsFetching(false);
    }
  }
  async function saveDraft() {
    if (selectedAuthType && !authorizedProviders[draft.providerKey || '']) {
      setAuthType(selectedAuthType);
      return;
    }
    await onSave({
      ...draft,
      name: draft.name || draft.provider || draft.model,
      provider: draft.provider || selectedPresetData?.label || 'Custom',
      protocol: protocolFromApiMode(draft.apiMode),
      kind: providerType === 'custom' ? 'relay' : draft.kind,
      models: availableModels.length ? availableModels : draft.models,
      pricing: emptyPricing,
    });
  }
  async function handleAuthSuccess() {
    const providerKey = draft.providerKey || selectedPreset;
    setAuthorizedProviders((current) => ({ ...current, [providerKey]: true }));
    setAuthType(null);
    await onSave({ ...draft, models: availableModels.length ? availableModels : draft.models, pricing: emptyPricing, apiKey: '' });
  }
  const saveDisabled = providerType === 'preset'
    ? !selectedPreset || !draft.model || !(availableModels.length || draft.models.length) || (!selectedAuthType && !draft.baseUrl)
    : !draft.baseUrl || !hasUsableApiKey || !draft.model || !(availableModels.length || draft.models.length);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal agent-editor provider-editor" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><h2>{model ? '编辑 Provider' : '添加 Provider'}</h2></div><button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
        <div className="agent-editor-body provider-editor-body">
          {!model && (
            <label className="provider-field"><span>Provider 类型</span><div className="provider-mode-tabs"><button type="button" className={providerType === 'preset' ? 'selected' : ''} onClick={() => resetForProviderType('preset')}>预设</button><button type="button" className={providerType === 'custom' ? 'selected' : ''} onClick={() => resetForProviderType('custom')}>自定义</button></div></label>
          )}
          {providerType === 'preset' ? (
            <>
              <label className="provider-field provider-combobox-wrap"><span>选择 Provider <em>*</em></span><ProviderPresetCombobox query={providerQuery} open={providerOpen} presets={filteredPresets} onOpenChange={setProviderOpen} onQueryChange={(value) => { setProviderQuery(value); setProviderOpen(true); }} onSelect={applyPreset} /></label>
              <label className="provider-field"><span>Base URL <em>*</em></span><input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="例如 https://api.example.com/v1" /></label>
              {!selectedAuthType && <label className="provider-field"><span>API Key <em>*</em></span><input value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="sk-..." type="password" /></label>}
              {selectedAuthType && <div className="auth-provider-note"><ShieldCheck size={16} /><span>{selectedPresetData?.label} 将通过授权登录保存到 Hermes Profile。</span></div>}
              <label className="provider-field"><span>默认模型 <em>*</em></span>{availableModels.length ? <select value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}>{availableModels.map((item) => <option key={item} value={item}>{item}</option>)}</select> : <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />}</label>
            </>
          ) : (
            <>
              <label className="provider-field"><span>名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="根据 Base URL 自动生成" /></label>
              <label className="provider-field"><span>Base URL <em>*</em></span><input value={draft.baseUrl} onChange={(event) => updateCustomBaseUrl(event.target.value)} placeholder="例如 https://api.example.com/v1" /></label>
              <label className="provider-field"><span>API Key <em>*</em></span><input value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="sk-..." type="password" /></label>
              <label className="provider-field"><span>默认模型 <em>*</em></span>{availableModels.length ? <select value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}>{availableModels.map((item) => <option key={item} value={item}>{item}</option>)}</select> : <input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />}</label>
              <label className="provider-field"><span>上下文长度</span><input value={draft.contextLimit ?? ''} onChange={(event) => { const parsed = Number(event.target.value); setDraft({ ...draft, contextLimit: event.target.value && Number.isFinite(parsed) ? Math.max(0, parsed) : null }); }} placeholder="例如 256000（可选）" inputMode="numeric" /></label>
              <label className="provider-field"><span>API 模式</span><select value={draft.apiMode || 'chat_completions'} onChange={(event) => setDraft({ ...draft, apiMode: event.target.value as ProviderApiMode })}><option value="chat_completions">chat_completions (/chat/completions)</option><option value="codex_responses">codex_responses (/responses)</option><option value="anthropic_messages">anthropic_messages (/messages)</option><option value="bedrock_converse">bedrock_converse (Converse API)</option><option value="codex_app_server">codex_app_server (App Server)</option></select></label>
            </>
          )}
          {fetchModelsVisible && <button type="button" className="secondary-btn provider-fetch" onClick={() => void handleFetchModels()} disabled={fetchModelsDisabled}>{isFetching ? '获取中' : '获取模型'}</button>}
          {fetchError && <div className="form-error">{fetchError}</div>}
          <div className="provider-modal-footer"><button className="secondary-btn" onClick={onClose}>取消</button><button className="send-btn" onClick={() => void saveDraft()} disabled={saveDisabled}>{selectedAuthType && !authorizedProviders[draft.providerKey || ''] ? '授权' : '添加'}</button></div>
        </div>
        {authType && <ProviderAuthModal authType={authType} onClose={() => setAuthType(null)} onSuccess={() => void handleAuthSuccess()} />}
      </div>
    </div>
  );
}

function ProviderPresetCombobox({ query, open, presets, onQueryChange, onOpenChange, onSelect }: { query: string; open: boolean; presets: ProviderPreset[]; onQueryChange: (value: string) => void; onOpenChange: (open: boolean) => void; onSelect: (value: string) => void }) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) onOpenChange(false);
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onOpenChange(false);
        inputRef.current?.blur();
      }
    }
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onOpenChange]);

  function selectPreset(value: string) {
    onOpenChange(false);
    inputRef.current?.blur();
    onSelect(value);
  }

  return (
    <div className="provider-combobox" ref={rootRef}>
      <div className="provider-combobox-input">
        <input ref={inputRef} value={query} onChange={(event) => onQueryChange(event.target.value)} onFocus={() => onOpenChange(true)} onKeyDown={(event) => { if (event.key === 'Escape') { onOpenChange(false); event.currentTarget.blur(); } }} placeholder="选择一个 provider..." />
        <button type="button" onClick={() => onOpenChange(!open)} aria-label="展开 Provider 列表"><ChevronDown size={16} /></button>
      </div>
      {open && (
        <div className="provider-combobox-menu">
          {presets.map((preset) => <button type="button" key={preset.value} onMouseDown={(event) => { event.preventDefault(); selectPreset(preset.value); }}>{preset.label}</button>)}
          {!presets.length && <span>没有匹配的 Provider</span>}
        </div>
      )}
    </div>
  );
}

function ProviderAuthModal({ authType, onClose, onSuccess }: { authType: ProviderAuthType; onClose: () => void; onSuccess: () => void }) {
  const [status, setStatus] = useState<'loading' | 'waiting' | 'submitting' | 'approved' | 'expired' | 'error'>('loading');
  const [sessionId, setSessionId] = useState('');
  const [userCode, setUserCode] = useState('');
  const [authUrl, setAuthUrl] = useState('');
  const [code, setCode] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    async function start() {
      try {
        const endpoint = authType === 'codex-device' ? '/api/auth/codex/start' : authType === 'claude-pkce' ? '/api/auth/claude/start' : '/api/auth/gemini/start';
        const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '授权启动失败。');
        if (cancelled) return;
        setSessionId(data.session_id || '');
        setAuthUrl(data.verification_url || data.authorization_url || '');
        setUserCode(data.user_code || '');
        setStatus('waiting');
        if (data.authorization_url) window.open(data.authorization_url, '_blank');
        if (authType !== 'claude-pkce') {
          const poll = async () => {
            try {
              const pollEndpoint = authType === 'codex-device' ? `/api/auth/codex/${data.session_id}` : `/api/auth/gemini/${data.session_id}`;
              const pollRes = await fetch(pollEndpoint);
              const pollData = await pollRes.json();
              if (cancelled) return;
              if (pollData.status === 'pending') {
                timer = window.setTimeout(poll, authType === 'codex-device' ? 3000 : 2000);
              } else if (pollData.status === 'approved') {
                setStatus('approved');
                window.setTimeout(onSuccess, 700);
              } else {
                setStatus(pollData.status === 'expired' ? 'expired' : 'error');
                setErrorMessage(pollData.error || '授权失败。');
              }
            } catch {
              if (!cancelled) timer = window.setTimeout(poll, 3000);
            }
          };
          timer = window.setTimeout(poll, 1200);
        }
      } catch (error) {
        if (!cancelled) {
          setStatus('error');
          setErrorMessage(error instanceof Error ? error.message : '授权启动失败。');
        }
      }
    }
    void start();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [authType, onSuccess]);
  async function submitClaudeCode() {
    if (!code.trim() || !sessionId) return;
    setStatus('submitting');
    try {
      const res = await fetch(`/api/auth/claude/${sessionId}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Claude 授权失败。');
      if (data.status === 'approved') {
        setStatus('approved');
        window.setTimeout(onSuccess, 700);
      } else {
        setStatus(data.status === 'expired' ? 'expired' : 'error');
        setErrorMessage(data.error || 'Claude 授权失败。');
      }
    } catch (error) {
      setStatus('error');
      setErrorMessage(error instanceof Error ? error.message : 'Claude 授权失败。');
    }
  }
  const title = authType === 'codex-device' ? 'OpenAI Codex 授权' : authType === 'claude-pkce' ? 'Claude OAuth 授权' : 'Google Gemini OAuth 授权';
  return (
    <div className="modal-backdrop nested" onClick={onClose}>
      <div className="modal auth-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><h2>{title}</h2><p>{status === 'waiting' ? '浏览器会打开授权页面，完成后回到这里。' : '正在准备授权。'}</p></div><button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
        <div className="auth-modal-body">
          {status === 'loading' && <div className="auth-state"><RefreshCw className="spin" size={22} /><span>正在启动授权...</span></div>}
          {status === 'waiting' && authType === 'codex-device' && <div className="auth-state"><strong className="auth-code">{userCode}</strong><button className="secondary-btn" onClick={() => navigator.clipboard?.writeText(userCode)}>复制授权码</button><button className="send-btn" onClick={() => window.open(authUrl, '_blank')}><ExternalLink size={15} />打开授权页面</button></div>}
          {status === 'waiting' && authType === 'gemini-loopback' && <div className="auth-state"><button className="send-btn" onClick={() => window.open(authUrl, '_blank')}><ExternalLink size={15} />打开 Google 授权</button><span>授权完成后会自动返回。</span></div>}
          {(status === 'waiting' || status === 'submitting') && authType === 'claude-pkce' && <div className="auth-state"><button className="send-btn" onClick={() => window.open(authUrl, '_blank')}><ExternalLink size={15} />打开 Claude 授权</button><textarea value={code} onChange={(event) => setCode(event.target.value)} placeholder="粘贴 Claude 返回的 code" /><button className="secondary-btn full" onClick={() => void submitClaudeCode()} disabled={!code.trim() || status === 'submitting'}>{status === 'submitting' ? '提交中' : '提交 code'}</button></div>}
          {status === 'approved' && <div className="auth-state success"><CheckCircle2 size={28} /><span>授权完成。</span></div>}
          {status === 'expired' && <div className="auth-state"><span>授权已过期，请重新发起。</span></div>}
          {status === 'error' && <div className="form-error">{errorMessage}</div>}
        </div>
      </div>
    </div>
  );
}

function modelKindLabel(kind: ModelKind) {
  if (kind === 'relay') return '第三方中转站';
  if (kind === 'local') return '本地模型';
  return '官方模型';
}

function modelPricingSummary(pricing?: ModelPricing) {
  if (!pricing || [pricing.input, pricing.output, pricing.cacheRead, pricing.cacheCreation].every((value) => value == null)) return '默认价格';
  return `in $${pricing.input ?? 0}/M · out $${pricing.output ?? 0}/M`;
}

function pricingSourceLabel(source?: string) {
  if (source === 'configured') return '配置价格';
  if (source === 'default') return '默认价格';
  return '未计价';
}

function OrgPage({ agents, models, hermesRuntime, selectedOrgAgentId, onSelectAgent, onProfilesChanged, onUpdateAgent, onDeleteAgent, onCreate, profileEditor, defaultAgentId, onUpdateDefaultAgent, onRefreshHermesRuntime, onStartProfileGateway }: {
  agents: Agent[];
  models: ModelProfile[];
  hermesRuntime: HermesRuntimeStatus | null;
  selectedOrgAgentId: string;
  onSelectAgent: (id: string) => void;
  onProfilesChanged: () => Promise<void>;
  onUpdateAgent: (agentId: string, payload: Partial<Agent>) => Promise<void>;
  onDeleteAgent: (id: string) => Promise<void>;
  onCreate: () => void;
  profileEditor: ProfileEditorControls;
  defaultAgentId: string;
  onUpdateDefaultAgent: (agentId: string) => void;
  onRefreshHermesRuntime: () => Promise<unknown>;
  onStartProfileGateway: (profileName: string) => Promise<void>;
}) {
  const selectedAgent = agents.find((agent) => agent.id === selectedOrgAgentId) || agents[0] || null;
  return (
    <section className="org-page">
      <div className="org-split-section">
        <div className="org-toolbar settings-head">
          <div><h2>Agent Profile</h2></div>
          <label className="org-default-agent">默认 Agent<select value={defaultAgentId} onChange={(event) => onUpdateDefaultAgent(event.target.value)}>{agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name}</option>)}</select></label>
        </div>
        <div className="profile-grid">
          {agents.map((agent) => {
            const gateway = gatewayForAgent(agent, hermesRuntime);
            return <button className={`profile-card ${selectedOrgAgentId === agent.id ? 'active' : ''}`} key={agent.id} onClick={() => onSelectAgent(agent.id)}><RuntimePulse gateway={gateway} /><AgentAvatar agent={agent} /><strong>{agent.name}</strong><small>{agent.role}</small><em>{agentDefaultModelLabel(agent, models)}</em><p>{agent.soulExcerpt || agent.soul || agent.scope}</p><span className={gatewayStatusClass(gateway)}>{gatewayStatusLabel(gateway)}</span></button>;
          })}
          <button className="profile-card profile-card-add" onClick={onCreate}><span className="profile-add-icon"><Plus size={22} /></span><strong>新建 Agent</strong><small>创建新的 Hermes Profile</small><p>填写基础资料后，可在下方继续编辑笔记、用户画像和灵魂。</p></button>
        </div>
        {selectedAgent && <AgentProfileDetail agent={selectedAgent} models={models} gateway={gatewayForAgent(selectedAgent, hermesRuntime)} onChanged={onProfilesChanged} onUpdateAgent={onUpdateAgent} onDelete={() => onDeleteAgent(selectedAgent.id)} profileEditor={profileEditor} onRefreshHermesRuntime={onRefreshHermesRuntime} onStartProfileGateway={onStartProfileGateway} />}
      </div>
    </section>
  );
}

function gatewayForAgent(agent: Agent, runtime: HermesRuntimeStatus | null) {
  const profileName = agent.profileName || agent.id;
  return runtime?.gateways?.find((gateway) => gateway.profileName === profileName) || null;
}

function gatewayStatusLabel(gateway: HermesRuntimeStatus['gateways'][number] | null) {
  if (gateway?.error) return '网关异常';
  if (gateway?.running) return '网关运行中';
  return '网关未运行';
}

function gatewayStatusClass(gateway: HermesRuntimeStatus['gateways'][number] | null) {
  if (gateway?.error) return 'gateway-status error';
  if (gateway?.running) return 'gateway-status running';
  return 'gateway-status idle';
}

function RuntimePulse({ gateway }: { gateway: HermesRuntimeStatus['gateways'][number] | null }) {
  return <span className={`runtime-pulse ${gateway?.error ? 'error' : gateway?.running ? 'running' : 'idle'}`} aria-label={gatewayStatusLabel(gateway)} title={gatewayStatusLabel(gateway)} />;
}

function AgentProfileDetail({ agent, models, gateway, onChanged, onUpdateAgent, onDelete, profileEditor, onRefreshHermesRuntime, onStartProfileGateway }: { agent: Agent; models: ModelProfile[]; gateway: HermesRuntimeStatus['gateways'][number] | null; onChanged: () => Promise<void>; onUpdateAgent: (agentId: string, payload: Partial<Agent>) => Promise<void>; onDelete: () => void; profileEditor: ProfileEditorControls; onRefreshHermesRuntime: () => Promise<unknown>; onStartProfileGateway: (profileName: string) => Promise<void> }) {
  const [tab, setTab] = useState<'notes' | 'user' | 'soul' | 'skills' | 'plugins'>('notes');
  const [avatarError, setAvatarError] = useState('');
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [avatarCropFile, setAvatarCropFile] = useState<File | null>(null);
  const [modelSaving, setModelSaving] = useState(false);
  const [modelError, setModelError] = useState('');
  const [nameEditing, setNameEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(agent.name);
  const [nameSaving, setNameSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const [runtimeConfigOpen, setRuntimeConfigOpen] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement | null>(null);
  const tabs = [
    { id: 'notes', label: '笔记' },
    { id: 'user', label: '用户画像' },
    { id: 'soul', label: '灵魂' },
    { id: 'skills', label: '技能' },
    { id: 'plugins', label: '插件' },
  ] as const;
  const editableProfileName = agent.source === 'hermes-profile' && agent.profileName ? agent.profileName : '';
  const runtimeProfileName = agent.profileName || agent.id;
  const modules = tab === 'skills' ? agent.skills || [] : agent.plugins || [];
  useEffect(() => {
    setNameDraft(agent.name);
    setNameEditing(false);
    setNameError('');
  }, [agent.id, agent.name]);
  function openEditor(kind: ProfileEditableKind, title: string, moduleName?: string) {
    if (!editableProfileName) return;
    void profileEditor.open({ agentId: agent.id, agentName: agent.name, profileName: editableProfileName, kind, title, moduleName });
  }
  function selectTab(nextTab: typeof tab) {
    if (nextTab === tab) return;
    if (profileEditor.state.target?.agentId === agent.id && !profileEditor.close()) return;
    setTab(nextTab);
  }
  function chooseAvatar(file: File | undefined) {
    if (!file || !editableProfileName) return;
    setAvatarError('');
    setAvatarCropFile(file);
    if (avatarInputRef.current) avatarInputRef.current.value = '';
  }

  async function uploadAvatar(data: string) {
    if (!editableProfileName) return;
    setAvatarSaving(true);
    try {
      const res = await fetch(`/api/hermes-profiles/${encodeURIComponent(editableProfileName)}/avatar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mimeType: 'image/png', data }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '头像保存失败。');
      setAvatarCropFile(null);
      await onChanged();
    } catch (error) {
      setAvatarError(error instanceof Error ? error.message : '头像保存失败。');
    } finally {
      setAvatarSaving(false);
    }
  }
  async function saveAgentModel(modelValue: string) {
    if (!modelValue || modelValue === modelValueForAgent(agent, models) || modelSaving) return;
    setModelError('');
    setModelSaving(true);
    try {
      await onUpdateAgent(agent.id, { model: modelValue });
    } catch (error) {
      setModelError(error instanceof Error ? error.message : '模型保存失败。');
    } finally {
      setModelSaving(false);
    }
  }
  async function saveAgentName() {
    const nextName = nameDraft.trim();
    if (!nextName) {
      setNameError('Agent 名字不能为空。');
      return;
    }
    if (nextName === agent.name) {
      setNameEditing(false);
      return;
    }
    setNameSaving(true);
    setNameError('');
    try {
      await onUpdateAgent(agent.id, { name: nextName });
      setNameEditing(false);
    } catch (error) {
      setNameError(error instanceof Error ? error.message : '名字保存失败。');
    } finally {
      setNameSaving(false);
    }
  }
  return (
    <section className="agent-profile-detail">
      <div className="agent-profile-hero">
        <button className="agent-profile-avatar" style={agent.avatarUrl ? undefined : { background: agent.color }} onClick={() => avatarInputRef.current?.click()} disabled={!editableProfileName || avatarSaving} title={editableProfileName ? '上传头像' : '保存为 Hermes Profile 后可上传头像'} aria-label="上传头像">
          {agent.avatarUrl ? <img src={agent.avatarUrl} alt="" /> : agent.name.slice(0, 1)}
        </button>
        <input ref={avatarInputRef} className="file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => chooseAvatar(event.target.files?.[0])} />
        <div className="agent-profile-main">
          {nameEditing ? (
            <div className="agent-name-editor">
              <input
                value={nameDraft}
                onChange={(event) => setNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void saveAgentName();
                  if (event.key === 'Escape') {
                    setNameDraft(agent.name);
                    setNameEditing(false);
                    setNameError('');
                  }
                }}
                autoFocus
              />
              <button className="secondary-btn" onClick={() => void saveAgentName()} disabled={nameSaving}>{nameSaving ? '保存中' : '保存'}</button>
              <button className="icon-btn" onClick={() => { setNameDraft(agent.name); setNameEditing(false); setNameError(''); }} aria-label="取消编辑名字"><X size={15} /></button>
            </div>
          ) : (
            <div className="agent-name-row">
              <h2>{agent.name}</h2>
              <button className="agent-name-edit" onClick={() => setNameEditing(true)} aria-label="编辑 Agent 名字" title="编辑 Agent 名字"><Pencil size={15} /></button>
            </div>
          )}
          <p>{agent.role}</p>
          {nameError && <div className="inline-error">{nameError}</div>}
          {avatarError && <div className="inline-error">{avatarError}</div>}
        </div>
        <button className="secondary-btn danger-btn agent-delete-btn" onClick={onDelete}><Trash2 size={15} />删除</button>
      </div>
      <div className="agent-profile-toolbar">
        <div className="agent-tabs">
          {tabs.map((item) => (
            <button className={tab === item.id ? 'selected' : ''} key={item.id} onClick={() => selectTab(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <label className="agent-default-model" aria-label="Agent 默认模型">
          <span>默认模型</span>
          <ProviderModelPicker
            models={models}
            value={modelValueForAgent(agent, models)}
            onChange={(value) => void saveAgentModel(value)}
            emptyLabel={modelSaving ? '保存中' : '未配置模型'}
            className="agent-default-model-picker"
            ariaLabel="选择 Agent 默认模型"
            title="选择 Agent 默认模型"
          />
        </label>
      </div>
      {modelError && <div className="inline-error">{modelError}</div>}
      {avatarCropFile && <AvatarCropModal file={avatarCropFile} title={`裁剪 ${agent.name} 的头像`} saving={avatarSaving} onCancel={() => setAvatarCropFile(null)} onSave={(data) => void uploadAvatar(data)} />}
      <div className="agent-runtime-row">
        <span>
          <RuntimePulse gateway={gateway} />
          <strong>{gatewayStatusLabel(gateway)}</strong>
          <small>{runtimeProfileName}</small>
          {gateway?.error && <em>{gateway.error}</em>}
        </span>
        <div>
          <button className="secondary-btn" onClick={() => void onRefreshHermesRuntime()}>刷新状态</button>
          <button className="secondary-btn" onClick={() => void onStartProfileGateway(runtimeProfileName)}>{gateway?.running ? '重启网关' : '启动网关'}</button>
        </div>
      </div>
      <div className={runtimeConfigOpen ? 'agent-runtime-config open' : 'agent-runtime-config'}>
        <button className="agent-runtime-config-toggle" onClick={() => setRuntimeConfigOpen((value) => !value)} aria-expanded={runtimeConfigOpen}>
          <span>
            <strong>运行配置</strong>
            <small>{runtimeProfileName ? `正在编辑：${runtimeProfileName}` : '这个 Agent 暂时没有绑定 Hermes Profile。'}</small>
          </span>
          <ChevronDown size={16} />
        </button>
        {runtimeConfigOpen && (
          runtimeProfileName ? (
            <HermesProfileConfigEditor profileName={runtimeProfileName} compact />
          ) : (
            <div className="empty-state">这个 Agent 暂时没有绑定 Hermes Profile。</div>
          )
        )}
      </div>
      <div className="agent-tab-panel">
        {tab === 'notes' && <EditableTextPanel agentId={agent.id} title="笔记" kind="notes" profileName={editableProfileName} text={agent.memory || ''} fallback={agent.memoryExcerpt || '这个 Profile 暂时没有 MEMORY.md 可展示。'} onEdit={() => openEditor('notes', '笔记')} editor={profileEditor} />}
        {tab === 'user' && <EditableTextPanel agentId={agent.id} title="用户画像" kind="user" profileName={editableProfileName} text={agent.userProfile || ''} fallback={agent.userProfileExcerpt || '这个 Profile 暂时没有 USER.md 可展示。'} onEdit={() => openEditor('user', '用户画像')} editor={profileEditor} />}
        {tab === 'soul' && <EditableTextPanel agentId={agent.id} title="灵魂" kind="soul" profileName={editableProfileName} text={agent.soul || ''} fallback={agent.soulExcerpt || '这个 Profile 暂时没有 SOUL.md 可展示。'} onEdit={() => openEditor('soul', '灵魂')} editor={profileEditor} />}
        {(tab === 'skills' || tab === 'plugins') && <EditableModuleList title={tab === 'skills' ? '技能' : '插件'} kind={tab === 'skills' ? 'skill' : 'plugin'} profileName={editableProfileName} items={modules} onSaved={onChanged} onEdit={(name) => openEditor('skill', '技能', name)} editor={profileEditor} agentId={agent.id} />}
      </div>
    </section>
  );
}

function EditableTextPanel({ agentId, title, kind, profileName, text, fallback, onEdit, editor }: { agentId: string; title: string; kind: 'notes' | 'user' | 'soul'; profileName: string; text: string; fallback: string; onEdit: () => void; editor: ProfileEditorControls }) {
  const isActive = editor.state.target?.agentId === agentId && editor.state.target.kind === kind;
  return (
    <div className="text-panel editable-panel">
      <div className="panel-edit-head">
        <strong>{title}</strong>
        {!isActive && (profileName ? <button className="secondary-btn" onClick={onEdit}><Pencil size={15} />编辑</button> : <span>保存为 Hermes Profile 后可编辑</span>)}
      </div>
      {isActive ? <InlineProfileEditor editor={editor} /> : <p>{text || fallback}</p>}
    </div>
  );
}

function EditableModuleList({ title, kind, profileName, items, onSaved, onEdit, editor, agentId }: { title: string; kind: 'skill' | 'plugin'; profileName: string; items: ProfileModuleEntry[]; onSaved: () => Promise<void>; onEdit: (name: string) => void; editor: ProfileEditorControls; agentId: string }) {
  const [view, setView] = useState<'cards' | 'list'>('cards');
  const [error, setError] = useState('');
  const [togglingName, setTogglingName] = useState('');
  const activeSkillTarget = kind === 'skill' && editor.state.target?.agentId === agentId && editor.state.target.kind === 'skill' ? editor.state.target : null;
  async function toggleSkill(item: ProfileModuleEntry) {
    if (!profileName || kind !== 'skill') return;
    const name = moduleEntryName(item);
    const enabled = !moduleEntryEnabled(item);
    setError('');
    setTogglingName(name);
    try {
      const res = await fetch(`/api/hermes-profiles/${encodeURIComponent(profileName)}/skill-state`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, enabled }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(payload.error || '状态保存失败。');
      await onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : '状态保存失败。');
    } finally {
      setTogglingName('');
    }
  }
  const emptyText = kind === 'skill' ? '当前 Profile 没有独立配置技能。' : '当前没有可展示的全局插件。';
  const lockedText = kind === 'skill' ? '保存为 Hermes Profile 后可配置技能' : '保存为 Hermes Profile 后可查看插件状态';
  if (activeSkillTarget) {
    return (
      <div className="module-panel editable-panel inline-skill-editor-panel">
        <div className="panel-edit-head module-panel-head">
          <div><strong>{title} / {activeSkillTarget.moduleName}</strong><span>{activeSkillTarget.profileName} · SKILL.md</span></div>
        </div>
        <InlineProfileEditor editor={editor} />
      </div>
    );
  }
  return (
    <div className="module-panel editable-panel">
      <div className="panel-edit-head module-panel-head">
        <div>
          <strong>{title}</strong>
          {kind === 'plugin' && <span>全局共享，状态按当前 Profile 显示</span>}
        </div>
        {profileName ? (
          <div className="module-view-tabs" aria-label={`${title}展示方式`}>
            <button className={view === 'cards' ? 'selected' : ''} onClick={() => setView('cards')}>卡片</button>
            <button className={view === 'list' ? 'selected' : ''} onClick={() => setView('list')}>列表</button>
          </div>
        ) : <span>{lockedText}</span>}
      </div>
      {items.length ? (
        <div className={view === 'cards' ? 'module-card-grid' : 'module-list'}>
          {items.map((item) => {
            const name = moduleEntryName(item);
            const enabled = moduleEntryEnabled(item);
            const status = moduleEntryStatus(item);
            const usage = moduleEntryUsage(item);
            const source = moduleEntrySource(item);
            return (
              <div className={view === 'cards' ? 'module-card' : 'module-row'} key={`${kind}-${name}`}>
                <div className="module-entry-main">
                  <div className="module-entry-title">
                    <span className={`module-state-dot ${enabled || status === 'enabled' ? 'on' : ''}`} />
                    <strong>{name}</strong>
                    <em className={`module-status ${enabled || status === 'enabled' ? 'on' : ''}`}>{moduleEntryStatusLabel(item)}</em>
                  </div>
                  <p>{moduleEntryDescription(item) || (kind === 'skill' ? '这个技能暂时没有描述。' : '全局插件，按当前 Profile 的启用配置显示。')}</p>
                  <div className="module-entry-meta">
                    {moduleEntryCategory(item) && <span>{moduleEntryCategory(item)}</span>}
                    {source && <span>{source === 'global' ? '全局' : source === 'profile' ? 'Profile' : source}</span>}
                    {usage.useCount ? <span>使用 {usage.useCount}</span> : null}
                    {usage.patchCount ? <span>修改 {usage.patchCount}</span> : null}
                  </div>
                </div>
                <div className="module-entry-actions">
                  {kind === 'skill' && profileName && (
                    <label className="module-switch" title={enabled ? '已启用' : '未启用'}>
                      <input type="checkbox" checked={enabled} disabled={togglingName === name} onChange={() => void toggleSkill(item)} />
                      <span />
                    </label>
                  )}
                  {kind === 'skill' && profileName && <button className="secondary-btn" onClick={() => onEdit(name)}><Pencil size={14} />编辑</button>}
                </div>
              </div>
            );
          })}
        </div>
      ) : <p>{emptyText}</p>}
      {error && <div className="form-error">{error}</div>}
    </div>
  );
}

function InlineProfileEditor({ editor }: { editor: ProfileEditorControls }) {
  const { state, dirty } = editor;
  if (state.loading) return <div className="inline-profile-editor-state">正在读取文件...</div>;
  if (state.errorStage === 'load') {
    return (
      <div className="inline-profile-editor-state error">
        <span>{state.error}</span>
        <button className="secondary-btn" onClick={editor.discard}>关闭</button>
      </div>
    );
  }
  return (
    <div className="inline-profile-editor">
      <textarea
        className="inline-profile-editor-textarea"
        value={state.draft}
        onChange={(event) => editor.changeDraft(event.target.value)}
        disabled={state.saving}
        spellCheck={false}
        autoFocus
      />
      <div className="inline-profile-editor-footer">
        <div className="inline-profile-editor-status">
          {state.error ? <span className="error">{state.error}</span> : dirty ? <span>有未保存修改</span> : <span>已同步</span>}
        </div>
        <div className="panel-edit-actions">
          <button className="secondary-btn" onClick={editor.discard} disabled={state.saving}>取消</button>
          <button className="send-btn" onClick={() => void editor.save()} disabled={state.saving || !dirty}>{state.saving ? '保存中' : '保存'}</button>
        </div>
      </div>
    </div>
  );
}

function AgentAvatar({ agent, size = 'md' }: { agent: Agent; size?: 'sm' | 'md' }) {
  return (
    <span className={`agent-avatar ${size}`} style={agent.avatarUrl ? undefined : { background: agent.color }}>
      {agent.avatarUrl ? <img src={agent.avatarUrl} alt="" /> : agent.name.slice(0, 1)}
    </span>
  );
}

function ThreadRailContent({ thread, agents, onOpen, onMore }: {
  thread: ThreadSummary;
  agents: Agent[];
  onOpen: () => void;
  onMore: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  const agentById = new Map(agents.map((agent) => [agent.id, agent]));
  const participantIds = [...new Set([
    ...(thread.participantAgentIds || []),
    thread.defaultAgentId,
    thread.activeAgentId,
    thread.primaryAgentId,
  ].filter((agentId): agentId is string => Boolean(agentId)))];
  const participants = participantIds.map((agentId) => agentById.get(agentId)).filter((agent): agent is Agent => Boolean(agent));
  const visibleParticipants = participants.slice(0, 3);
  const hiddenCount = Math.max(0, participants.length - visibleParticipants.length);
  const statusLabel = thread.runStatus === 'running' ? '运行中' : thread.runStatus === 'failed' ? '运行失败' : '就绪';
  const participantLabel = participants.length ? participants.map((agent) => agent.name).join('、') : (thread.primaryAgentName || 'Agent');

  return (
    <>
      <button className="rail-main rail-thread-main" onClick={onOpen} aria-label={`${thread.title}，参与 Agent：${participantLabel}，${statusLabel}`}>
        <span className="rail-thread-line">
          <strong className="rail-thread-title">{thread.title}</strong>
          <span className={`rail-thread-participants ${thread.runStatus || 'idle'}`} title={participantLabel} aria-hidden="true">
            {visibleParticipants.map((agent) => {
              const isActive = agent.id === (thread.activeAgentId || thread.defaultAgentId || thread.primaryAgentId);
              return (
                <span className={`rail-thread-avatar ${thread.runStatus === 'running' && isActive ? 'active-running' : ''} ${thread.runStatus === 'failed' && isActive ? 'active-failed' : ''}`} key={agent.id} style={agent.avatarUrl ? undefined : { background: agent.color }}>
                  {agent.avatarUrl ? <img src={agent.avatarUrl} alt="" /> : agent.name.slice(0, 1).toUpperCase()}
                </span>
              );
            })}
            {hiddenCount > 0 && <span className="rail-thread-overflow">+{hiddenCount}</span>}
          </span>
        </span>
      </button>
      <button className="rail-more-button" onClick={onMore} aria-label={`更多对话操作：${thread.title}`} title="更多">
        <MoreHorizontal size={15} />
      </button>
    </>
  );
}

function FirstUseGuideOverlay({ guide, onClose, onRetry, onInstall }: { guide: FirstUseGuideState; onClose: () => void; onRetry: () => void; onInstall: () => void }) {
  const busy = guide.status === 'running';
  const done = guide.status === 'ready';
  const needsInstall = guide.status === 'needs-install';
  return (
    <div className="first-use-screen" role="dialog" aria-modal="true" aria-labelledby="first-use-title">
      <div className="first-use-panel">
        <div className="first-use-orbit" aria-hidden="true">
          <LaunchAvatar pulse={false} />
          <span className={`first-use-ring ${busy ? 'running' : done ? 'done' : guide.status === 'failed' ? 'failed' : ''}`} />
        </div>
        <div className="first-use-body">
          <div className="first-use-head">
            <span>Frakio Work for Hermes Agent</span>
            <h2 id="first-use-title">{guide.title}</h2>
            <p>{guide.detail}</p>
          </div>
          <div className="first-use-steps">
            {guide.steps.map((step) => {
              const Icon = step.status === 'ready' || step.status === 'skipped' ? CheckCircle2 : step.status === 'failed' ? ShieldAlert : step.status === 'running' ? RefreshCw : Circle;
              return (
                <div className={`first-use-step ${step.status}`} key={step.id}>
                  <Icon className={step.status === 'running' ? 'spin' : ''} size={16} />
                  <span><strong>{step.label}</strong><small>{step.detail}</small></span>
                </div>
              );
            })}
          </div>
          {guide.error && <div className="form-error">{guide.error}</div>}
          <div className="first-use-actions">
            {needsInstall && <button className="secondary-btn" onClick={onInstall}>准备 Hermes Agent</button>}
            {guide.status === 'failed' && <button className="secondary-btn" onClick={onRetry}>重新运行</button>}
            <button className={done ? 'send-btn' : 'secondary-btn'} onClick={onClose} disabled={busy}>{busy ? '运行中' : done ? '进入工作台' : '稍后处理'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LaunchLoadingScreen({ phase, agent, userAvatarUrl, autoStart }: { phase: LaunchPhase; agent: Agent | null; userAvatarUrl: string; autoStart: HermesRuntimeStatus['autoStart'] | null }) {
  const steps = launchSteps(autoStart);
  return (
    <div className={`launch-screen ${phase === 'welcome' ? 'welcome' : 'working'}`} role="status" aria-live="polite">
      <div className={`launch-shell ${userAvatarUrl ? 'has-user-avatar' : 'no-user-avatar'}`}>
        <LaunchAvatar pulse={false} />
        <div className="launch-content-stage">
          <div className="launch-panel launch-working-panel">
            <div className="launch-head">
              <strong>正在连接本地 Hermes Agent</strong>
              <span>{agent ? `${agent.name} 正在准备工作环境` : '正在准备工作环境'}</span>
            </div>
            <div className="launch-task-list">
              {steps.map((step) => {
                const done = step.status === 'ready' || step.status === 'skipped';
                const active = step.status === 'running';
                const failed = step.status === 'failed';
                const Icon = done ? CheckCircle2 : active ? Clock3 : Circle;
                return (
                  <div className={`task-row ${done ? 'done' : ''} ${active ? 'active' : ''} ${failed ? 'failed' : ''}`} key={step.id}>
                    <Icon size={15} />
                    <span><strong>{step.label}</strong>{step.detail && <small>{step.detail}</small>}</span>
                  </div>
                );
              })}
            </div>
          </div>
          <div className="launch-panel launch-welcome-panel">
            <div className="launch-welcome">
              <span>Hi，</span>
              {userAvatarUrl && <span className="launch-user-avatar"><img src={userAvatarUrl} alt="" /></span>}
              <span>欢迎回来</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function LaunchAvatar({ pulse }: { pulse: boolean }) {
  return (
    <span className={`launch-image-avatar brand-logo ${pulse ? 'pulse' : ''}`}>
      <img src={frakioBrandLogoUrl} alt="" />
    </span>
  );
}

function readLaunchUserAvatarSnapshot() {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(launchUserAvatarSnapshotKey);
    return value ? String(value) : null;
  } catch {
    return null;
  }
}

function readFirstUseGuideCompleted() {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(firstUseGuideStorageKey) === '1';
  } catch {
    return false;
  }
}

function writeFirstUseGuideCompleted() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(firstUseGuideStorageKey, '1');
  } catch {
    // First-use guide can still run without persistent browser storage.
  }
}

function createFirstUseGuideSteps(): FirstUseGuideStep[] {
  return [
    { id: 'detect', label: '检测本机 Hermes', detail: '等待开始', status: 'pending' },
    { id: 'runtime', label: '启动本地 runtime', detail: '等待检测完成', status: 'pending' },
    { id: 'import', label: '同步 Profile 配置', detail: '模型仍由用户在模型中心配置', status: 'pending' },
    { id: 'finish', label: '完成连接', detail: '等待同步完成', status: 'pending' },
  ];
}

function createHermesInstallGuideSteps(): FirstUseGuideStep[] {
  return [
    { id: 'check-tools', label: '检查依赖', detail: '等待开始', status: 'pending' },
    { id: 'download', label: '下载 Hermes Agent', detail: '等待依赖检查完成', status: 'pending' },
    { id: 'setup-runtime', label: '安装 Python 环境', detail: '等待源码就绪', status: 'pending' },
    { id: 'verify-cli', label: '创建 Hermes CLI', detail: '等待 Python 环境完成', status: 'pending' },
    { id: 'write-config', label: '写入基础配置', detail: '等待 CLI 检测完成', status: 'pending' },
    { id: 'detect', label: '重新检测', detail: '等待配置写入完成', status: 'pending' },
  ];
}

function installStepSuccessDetail(stepId: string, data: any) {
  if (stepId === 'check-tools') {
    const tools = data?.tools || {};
    return `git ${tools.git ? 'ok' : 'missing'} · python3 ${tools.python3 ? 'ok' : 'missing'} · uv ${tools.uv ? 'ok' : '由官方脚本处理'}`;
  }
  if (stepId === 'download') return data?.bootstrap?.sourcePath || '官方仓库已准备';
  if (stepId === 'setup-runtime') return '官方 setup-hermes.sh 已完成';
  if (stepId === 'verify-cli') return data?.tools?.hermes || 'hermes CLI 可执行';
  if (stepId === 'write-config') return '~/.hermes/config.yaml 和 .env 已准备';
  return data?.bootstrap?.status === 'connected' ? '本地 Hermes 已连接' : '已完成安装后检测';
}

function installLogSummary(logs?: string[]) {
  if (!Array.isArray(logs) || !logs.length) return '';
  const clean = logs
    .map((line) => String(line || '').replace(/\u001b\[[0-9;]*m/g, '').trim())
    .filter(Boolean);
  return clean.slice(-3).join(' · ').slice(0, 260);
}

function markInstallFailure(steps: FirstUseGuideStep[], message: string, phase?: string) {
  const failedPhase = phase === 'start-runtime' ? 'detect' : phase;
  let failed = false;
  return steps.map((step) => {
    if (failedPhase && step.id === failedPhase) {
      failed = true;
      return { ...step, status: 'failed' as const, detail: message };
    }
    if (failed) return step;
    if (step.status === 'running' || step.status === 'pending') {
      failed = true;
      return { ...step, status: 'failed' as const, detail: message };
    }
    return step;
  });
}

function createFirstUseGuideState(): FirstUseGuideState {
  return {
    status: 'idle',
    title: '初次使用引导',
    detail: '检测并连接本机 Hermes Agent。',
    error: '',
    steps: createFirstUseGuideSteps(),
  };
}

function writeLaunchUserAvatarSnapshot(avatarUrl: string | null) {
  if (typeof window === 'undefined') return;
  try {
    if (avatarUrl) window.localStorage.setItem(launchUserAvatarSnapshotKey, avatarUrl);
    else window.localStorage.removeItem(launchUserAvatarSnapshotKey);
  } catch {
    // localStorage can be disabled; the launch screen still renders from live profile data.
  }
}

function launchSteps(autoStart: HermesRuntimeStatus['autoStart'] | null) {
  const fallback: NonNullable<HermesRuntimeStatus['autoStart']>['steps'] = [
    { id: 'profiles', label: '读取本地 Hermes Profiles', status: 'running' as const },
    { id: 'bridge', label: '启动 Frakio Work Bridge', status: 'running' as const },
    { id: 'api', label: '启动 Frakio Work Runtime API', status: 'running' as const },
    { id: 'gateways', label: '启动 Profile Gateway', status: 'running' as const },
  ];
  return autoStart?.steps?.length ? autoStart.steps : fallback;
}

function MessageAvatar({ message, agents, userProfile }: { message: ChatEvent; agents: Agent[]; userProfile?: UserProfile }) {
  if (message.agentId === 'user') {
    const nickname = String(userProfile?.nickname || '').trim();
    const avatarUrl = String(userProfile?.avatarUrl || '').trim();
    if (!nickname && !avatarUrl) return null;
    return (
      <span className="user-message-avatar">
        {avatarUrl ? <img src={avatarUrl} alt="" /> : nickname.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  const agent = agents.find((item) => item.id === message.agentId);
  if (agent) return <AgentAvatar agent={agent} />;
  return <span className="agent-avatar" style={{ background: agentColor(agents, message.agentId) }}>{message.agentName.slice(0, 1)}</span>;
}

function MentionTextarea({ value, onChange, onSend, sendKey, agents, selectedAgentIds, placeholder }: {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sendKey: WorkbenchUiSettings['sendKey'];
  agents: Agent[];
  selectedAgentIds: string[];
  placeholder: string;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [mentionActive, setMentionActive] = useState(false);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionStartIndex, setMentionStartIndex] = useState(-1);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isComposing, setIsComposing] = useState(false);
  const options = buildMentionOptions(agents, selectedAgentIds, mentionQuery).slice(0, 8);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = Number.parseFloat(getComputedStyle(el).maxHeight);
    const nextHeight = Number.isFinite(maxHeight) ? Math.min(el.scrollHeight, maxHeight) : el.scrollHeight;
    el.style.height = `${nextHeight}px`;
    el.style.overflowY = el.scrollHeight > nextHeight + 1 ? 'auto' : 'hidden';
  }, [value]);

  useEffect(() => {
    function onMouseDown(event: MouseEvent) {
      if (!mentionActive) return;
      const target = event.target as HTMLElement;
      if (!target.closest('.mention-menu')) setMentionActive(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [mentionActive]);

  useEffect(() => {
    const active = dropdownRef.current?.querySelector('.active') as HTMLElement | null;
    active?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex]);

  function updateMentionState(nextValue = value) {
    const el = textareaRef.current;
    if (!el) return;
    const cursorPos = el.selectionStart;
    let atPos = -1;
    for (let index = cursorPos - 1; index >= 0; index -= 1) {
      const char = nextValue[index];
      if (char === '@') {
        atPos = index;
        break;
      }
      if (/\s/.test(char || '')) break;
    }
    if (atPos === -1 || (atPos > 0 && !/\s/.test(nextValue[atPos - 1] || ''))) {
      setMentionActive(false);
      return;
    }
    const query = nextValue.slice(atPos + 1, cursorPos);
    if (/\s/.test(query)) {
      setMentionActive(false);
      return;
    }
    const nextOptions = buildMentionOptions(agents, selectedAgentIds, query);
    setMentionQuery(query);
    setMentionStartIndex(atPos);
    setActiveIndex(0);
    setMentionActive(nextOptions.length > 0);
  }

  function selectMention(option: MentionOption) {
    const el = textareaRef.current;
    if (!el || mentionStartIndex < 0) return;
    const before = value.slice(0, mentionStartIndex);
    const after = value.slice(el.selectionStart);
    const insert = `@${option.name} `;
    const nextValue = `${before}${insert}${after}`;
    onChange(nextValue);
    setMentionActive(false);
    requestAnimationFrame(() => {
      const nextPos = before.length + insert.length;
      el.focus();
      el.setSelectionRange(nextPos, nextPos);
    });
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (mentionActive && options.length) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setActiveIndex((index) => (index + 1) % options.length);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setActiveIndex((index) => (index - 1 + options.length) % options.length);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        selectMention(options[activeIndex]);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setMentionActive(false);
        return;
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && (sendKey !== 'mod-enter' || event.metaKey || event.ctrlKey)) {
      if (isComposing || event.nativeEvent.isComposing) return;
      event.preventDefault();
      onSend();
    }
  }

  return (
    <div className="mention-textarea-wrap">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          if (!isComposing) requestAnimationFrame(() => updateMentionState(event.target.value));
        }}
        onKeyDown={handleKeyDown}
        onCompositionStart={() => setIsComposing(true)}
        onCompositionEnd={() => {
          setIsComposing(false);
          requestAnimationFrame(() => updateMentionState());
        }}
        onClick={() => updateMentionState()}
        placeholder={placeholder}
      />
      {mentionActive && options.length > 0 && (
        <div className="mention-menu" ref={dropdownRef}>
          {options.map((option, index) => (
            <button
              type="button"
              className={index === activeIndex ? 'mention-option active' : 'mention-option'}
              key={option.key}
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                selectMention(option);
              }}
            >
              {option.agent ? <AgentAvatar agent={option.agent} size="sm" /> : <span className="mention-all-avatar">@</span>}
              <span><strong>{option.label}</strong><small>{option.description}</small></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AgentSessionModelModal({ agent, models, value, onClose, onSave, onOpenModels }: { agent: Agent | null; models: ModelProfile[]; value: string; onClose: () => void; onSave: (agentId: string, modelId: string) => Promise<void>; onOpenModels: () => void }) {
  const availableModels = hermesProfileModels(models);
  const [draftModelId, setDraftModelId] = useState(value || (availableModels[0] ? modelChoiceValue(availableModels[0], availableModels[0].model) : ''));
  useEffect(() => setDraftModelId(value || (availableModels[0] ? modelChoiceValue(availableModels[0], availableModels[0].model) : '')), [value, models.length, agent?.id]);
  if (!agent) return null;
  const disabled = !availableModels.length || !draftModelId;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal agent-model-modal" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head">
          <div><h2>{agent.name} 的本会话模型</h2><p>只影响当前对话，不修改 Agent 默认模型。</p></div>
          <button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={18} /></button>
        </div>
        <div className="agent-model-body">
          <div className="agent-model-target">
            <AgentAvatar agent={agent} />
            <span><strong>{agent.name}</strong><small>默认模型：{agentDefaultModelLabel(agent, models)}</small></span>
          </div>
          <label className="form-row">
            <span>本会话使用模型</span>
            <ProviderModelPicker models={availableModels} value={draftModelId} onChange={setDraftModelId} emptyLabel="未配置模型" />
          </label>
          {!availableModels.length && <div className="inline-error">还没有可选模型，请先进入模型中心配置。</div>}
          <div className="modal-actions">
            <button className="secondary-btn" onClick={onOpenModels}>进入模型中心</button>
            <button className="send-btn" disabled={disabled} onClick={() => void onSave(agent.id, draftModelId)}>保存本会话模型</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function RailContextMenu({ target, canShowInFinder, onClose, onToggleWorkspacePinned, onRenameWorkspace, onArchiveWorkspace, onDeleteWorkspace, onShowInFinder, onCopyText, onEditSpace, onToggleThreadPinned, onRenameThread, onArchiveThread, onDeleteThread }: {
  target: RailContextMenuTarget;
  canShowInFinder: boolean;
  onClose: () => void;
  onToggleWorkspacePinned: (workspace: Workspace) => Promise<void>;
  onRenameWorkspace: (workspace: Workspace) => Promise<void>;
  onArchiveWorkspace: (workspace: Workspace) => void;
  onDeleteWorkspace: (workspace: Workspace) => void;
  onShowInFinder: (targetPath: string) => Promise<void>;
  onCopyText: (value: string) => Promise<void>;
  onEditSpace: (space: Space) => void;
  onToggleThreadPinned: (thread: ThreadSummary) => Promise<void>;
  onRenameThread: (thread: ThreadSummary) => Promise<void>;
  onArchiveThread: (thread: ThreadSummary) => void;
  onDeleteThread: (thread: ThreadSummary) => void;
}) {
  const isWorkspace = target.kind === 'workspace';
  const workspace = isWorkspace ? target.workspace : null;
  const thread = target.kind === 'thread' ? target.thread : null;
  const space = target.kind === 'space' ? target.space : null;
  const rootPath = workspace?.rootPath || thread?.workspaceRootPath || '';
  const menuWidth = space ? 206 : 230;
  const menuHeight = space ? 104 : 310;
  const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
  const menuStyle = (() => {
    if (space && target.anchorRect) {
      const sidebarLeft = target.sidebarRect?.left ?? 8;
      const sidebarRight = target.sidebarRect?.right ?? window.innerWidth - 8;
      const minLeft = Math.max(8, sidebarLeft + 8);
      const maxLeft = Math.max(minLeft, Math.min(window.innerWidth - menuWidth - 8, sidebarRight - menuWidth - 8));
      const anchoredLeft = target.anchorRect.left + (target.anchorRect.width / 2) - (menuWidth / 2);
      const aboveTop = target.anchorRect.top - menuHeight - 10;
      const fallbackTop = target.anchorRect.bottom + 10;
      return {
        left: clamp(anchoredLeft, minLeft, maxLeft),
        top: aboveTop >= 8 ? aboveTop : clamp(fallbackTop, 8, window.innerHeight - menuHeight - 8),
      } as React.CSSProperties;
    }
    return {
      left: clamp(target.x, 8, window.innerWidth - menuWidth - 8),
      top: clamp(target.y, 8, window.innerHeight - menuHeight - 8),
    } as React.CSSProperties;
  })();
  async function run(action: () => void | Promise<void>) {
    onClose();
    await action();
  }
  return (
    <div className={space ? 'rail-context-menu space-context-menu' : 'rail-context-menu'} style={menuStyle} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}>
      {space ? (
        <>
          <button onClick={() => void run(() => onEditSpace(space))}>编辑工作区</button>
          <i />
          <button onClick={() => void run(() => onCopyText(space.id))}>复制工作区 ID</button>
        </>
      ) : workspace ? (
        <>
          <button onClick={() => void run(() => onToggleWorkspacePinned(workspace))}>{workspace.pinnedAt ? '取消置顶项目' : '置顶项目'}</button>
          <button onClick={() => void run(() => onRenameWorkspace(workspace))}>重命名项目</button>
          <button onClick={() => void run(() => onArchiveWorkspace(workspace))}>归档项目</button>
          <i />
          <button disabled={!canShowInFinder || !rootPath} onClick={() => void run(() => onShowInFinder(rootPath))}>在 Finder 中显示</button>
          <button disabled={!rootPath} onClick={() => void run(() => onCopyText(rootPath))}>复制项目路径</button>
          <button onClick={() => void run(() => onCopyText(workspace.id))}>复制项目 ID</button>
          <i />
          <button className="danger" onClick={() => void run(() => onDeleteWorkspace(workspace))}>删除项目</button>
        </>
      ) : thread ? (
        <>
          <button onClick={() => void run(() => onToggleThreadPinned(thread))}>{thread.pinnedAt ? '取消置顶对话' : '置顶对话'}</button>
          <button onClick={() => void run(() => onRenameThread(thread))}>重命名对话</button>
          <button onClick={() => void run(() => onArchiveThread(thread))}>归档对话</button>
          <i />
          <button disabled={!canShowInFinder || !rootPath} onClick={() => void run(() => onShowInFinder(rootPath))}>在 Finder 中显示</button>
          <button disabled={!rootPath} onClick={() => void run(() => onCopyText(rootPath))}>复制项目路径</button>
          <button onClick={() => void run(() => onCopyText(thread.id))}>复制会话 ID</button>
          <i />
          <button className="danger" onClick={() => void run(() => onDeleteThread(thread))}>删除对话</button>
        </>
      ) : null}
    </div>
  );
}

function RailConfirmPopover({ target, onCancel, onConfirm }: { target: Exclude<RailConfirm, null>; onCancel: () => void; onConfirm: () => void }) {
  const noun = target.kind === 'workspace' ? '项目' : '对话';
  const hint = target.kind === 'workspace'
    ? '只移除 Frakio Work 记录，不删除本地文件夹。'
    : '删除后会从侧栏移除，不进入归档。';
  const style = {
    left: Math.min(target.x, window.innerWidth - 230),
    top: Math.min(Math.max(8, target.y), window.innerHeight - 128),
  } as React.CSSProperties;
  return (
    <div
      className="rail-confirm-popover"
      style={style}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <strong>删除{noun}？</strong>
      <span>{target.title}</span>
      <small>{hint}</small>
      <div>
        <button className="secondary-btn compact" onClick={onCancel}>取消</button>
        <button className="secondary-btn compact danger" onClick={onConfirm}>删除</button>
      </div>
    </div>
  );
}

function trimMessageStart(content: string) {
  return String(content || '').replace(/^\s*\n+/, '').trimStart();
}

function MarkdownMessage({ content, streaming }: { content: string; streaming?: boolean }) {
  return (
    <div className={streaming ? 'message-text markdown-message streaming-text' : 'message-text markdown-message'}>
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{trimMessageStart(content)}</ReactMarkdown>
      {streaming && <span className="streaming-cursor" />}
    </div>
  );
}

function ComposerRunButton({
  isRunning,
  hasActiveRun,
  isStopping,
  canSend,
  onSend,
  onStop,
}: {
  isRunning: boolean;
  hasActiveRun: boolean;
  isStopping: boolean;
  canSend: boolean;
  onSend: () => void;
  onStop: () => void;
}) {
  const phase = isRunning
    ? isStopping ? 'stopping' : hasActiveRun ? 'running' : 'starting'
    : 'idle';
  const label = phase === 'starting'
    ? '正在启动'
    : phase === 'running'
      ? '停止生成'
      : phase === 'stopping'
        ? '正在停止'
        : '发送消息';
  const disabled = phase === 'starting' || phase === 'stopping' || (phase === 'idle' && !canSend);
  return (
    <button
      className={`composer-run-button is-${phase}`}
      type="button"
      aria-label={label}
      aria-busy={phase === 'starting' || phase === 'stopping'}
      title={label}
      disabled={disabled}
      onClick={phase === 'running' ? onStop : onSend}
    >
      {phase === 'idle' && <ArrowUp size={18} strokeWidth={2.6} aria-hidden="true" />}
      {phase === 'running' && <Square className="composer-run-stop-icon" size={11} fill="currentColor" strokeWidth={0} aria-hidden="true" />}
      {(phase === 'starting' || phase === 'stopping') && <LoaderCircle className="composer-run-spinner" size={16} strokeWidth={2.2} aria-hidden="true" />}
    </button>
  );
}

function ChatRunStatus({
  target,
  startedAt,
  tick,
  draft,
  error,
}: {
  target: ChatRunTarget | null;
  startedAt: number | null;
  tick: number;
  draft: string;
  error: string;
}) {
  const elapsed = startedAt ? Math.max(0, Math.floor((Date.now() - startedAt) / 1000)) : 0;
  const agent = target?.agent || null;
  const isAll = target?.kind === 'all';
  const title = isAll ? '团队' : agent?.name || 'Agent';
  const thinkingText = isAll ? '团队正在思考' : `${agent?.name || 'Agent'} 正在思考`;
  void tick;
  return (
    <article className="message run-status-message">
      {isAll || !agent ? <span className="agent-avatar" style={{ background: agent?.color || '#0f766e' }}>@</span> : <AgentAvatar agent={agent} />}
      <div className="message-body run-status-body">
        <div className="message-meta">
          <strong>{title}</strong>
          <span>{elapsed}s</span>
        </div>
        <div className="thinking-line" aria-live="polite">
          <span className="thinking-text">{thinkingText}</span>
        </div>
        {draft && <MarkdownMessage content={draft} streaming />}
        {error && <div className="inline-error run-error">{error}</div>}
      </div>
    </article>
  );
}

function RunDecisionPanel({ clarification, approval, submitting, error, onAnswer, onSkip, onApprove }: {
  clarification: HermesRunClarification | null;
  approval: HermesRunApproval | null;
  submitting: boolean;
  error: string;
  onAnswer: (answer: string) => void;
  onSkip: () => void;
  onApprove: (choice: 'once' | 'session' | 'always' | 'deny') => void;
}) {
  const isClarification = Boolean(clarification);
  const requestKey = clarification?.id || approval?.id || 'decision';
  const [activeIndex, setActiveIndex] = useState(0);
  const [customOpen, setCustomOpen] = useState(Boolean(clarification && !clarification.choices.length));
  const [customAnswer, setCustomAnswer] = useState('');
  const panelRef = useRef<HTMLElement | null>(null);
  const approvalChoices = [
    { value: 'once' as const, label: '允许一次', description: '只允许当前这一次操作' },
    { value: 'session' as const, label: '本会话允许', description: '当前对话中允许同类操作' },
    { value: 'always' as const, label: '始终允许', description: '以后自动允许同类操作' },
    { value: 'deny' as const, label: '拒绝', description: '不执行这项操作' },
  ];
  const optionCount = clarification?.choices.length || approvalChoices.length;

  useEffect(() => {
    setActiveIndex(0);
    setCustomOpen(Boolean(clarification && !clarification.choices.length));
    setCustomAnswer('');
    const frame = window.requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('.run-decision-option')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [requestKey, clarification]);

  const chooseActive = (index: number) => {
    if (submitting || index < 0 || index >= optionCount) return;
    setActiveIndex(index);
    if (clarification) onAnswer(clarification.choices[index]);
    else onApprove(approvalChoices[index].value);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      if (clarification && !submitting) onSkip();
      return;
    }
    if (/^[1-9]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (index < optionCount) {
        event.preventDefault();
        chooseActive(index);
      }
      return;
    }
    if (!optionCount) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const nextIndex = (activeIndex + direction + optionCount) % optionCount;
      setActiveIndex(nextIndex);
      panelRef.current?.querySelectorAll<HTMLButtonElement>('.run-decision-option')[nextIndex]?.focus();
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      chooseActive(activeIndex);
    }
  };

  return (
    <section className={`run-decision-panel ${isClarification ? 'clarification' : 'approval'}`} ref={panelRef} onKeyDown={onKeyDown} aria-labelledby="run-decision-title">
      <header className="run-decision-head">
        {clarification && <button className="run-decision-close" onClick={onSkip} disabled={submitting} aria-label="跳过此问题"><X size={17} /></button>}
        <div>
          <span>{clarification ? '需要你的选择' : '此操作需要你的允许'}</span>
          <strong id="run-decision-title">{clarification?.question || approval?.title || '请选择如何执行'}</strong>
          <small>{clarification ? '选择一项后，Agent 会继续处理。' : '请选择本次操作的允许范围。'}</small>
        </div>
      </header>

      {approval && (approval.tool || approval.command || approval.cwd) && (
        <div className="run-decision-command">
          {approval.tool && <span>{approval.tool}</span>}
          {approval.command && <code>{approval.command}</code>}
          {approval.cwd && <small>{approval.cwd}</small>}
        </div>
      )}

      <div className="run-decision-options" role="group" aria-label={clarification ? '回答选项' : '权限选项'}>
        {clarification ? clarification.choices.map((choice, index) => (
          <button className={`run-decision-option ${activeIndex === index ? 'active' : ''}`} key={`${index}-${choice}`} disabled={submitting} onClick={() => chooseActive(index)} onFocus={() => setActiveIndex(index)}>
            <span className="run-decision-number">{index + 1}</span>
            <strong>{choice}</strong>
            <ChevronRight size={16} />
          </button>
        )) : approvalChoices.map((choice, index) => (
          <button className={`run-decision-option ${choice.value === 'deny' ? 'danger' : ''} ${activeIndex === index ? 'active' : ''}`} key={choice.value} disabled={submitting} onClick={() => chooseActive(index)} onFocus={() => setActiveIndex(index)}>
            <span className="run-decision-number">{index + 1}</span>
            <span><strong>{choice.label}</strong><small>{choice.description}</small></span>
            <ChevronRight size={16} />
          </button>
        ))}
      </div>

      {clarification && (
        <div className="run-decision-custom">
          {!customOpen && <button onClick={() => setCustomOpen(true)} disabled={submitting}>其他</button>}
          {customOpen && (
            <div>
              <input value={customAnswer} onChange={(event) => setCustomAnswer(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && customAnswer.trim() && !submitting) onAnswer(customAnswer.trim()); }} placeholder="输入自己的回答" aria-label="自定义回答" autoFocus={!clarification.choices.length} />
              <button className="run-decision-send" onClick={() => onAnswer(customAnswer.trim())} disabled={submitting || !customAnswer.trim()} aria-label="发送自定义回答"><Send size={16} /></button>
            </div>
          )}
        </div>
      )}

      <footer className="run-decision-footer">
        {error ? <span className="run-decision-error" role="alert">{error}</span> : <span>{submitting ? '正在提交…' : '可使用方向键、数字键或鼠标选择'}</span>}
        {clarification && <button onClick={onSkip} disabled={submitting}>跳过</button>}
      </footer>
    </section>
  );
}

function CompletedRunStatus({ summary }: { summary: CompletedRunSummary }) {
  return (
    <div className="run-complete-summary">
      <span>已处理 {formatDuration(summary.elapsedSeconds)}</span>
      <ChevronDown size={15} />
    </div>
  );
}

function AgentEditorModal({ title, models, agent, onClose, onSave }: { title: string; models: ModelProfile[]; agent: Agent | null; onClose: () => void; onSave: (payload: Partial<Agent>) => Promise<void> }) {
  const emptyAgent = { id: '', name: '', role: '', model: 'Hermes default', color: '#0f766e', soul: '', scope: '' };
  const [draft, setDraft] = useState<Agent>(agent || emptyAgent);
  useEffect(() => {
    setDraft(agent || emptyAgent);
  }, [agent?.id]);
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal agent-editor" onClick={(event) => event.stopPropagation()}>
        <div className="modal-head"><div><h2>{title}</h2><p>编辑 Agent 的模型、Soul 和职责。</p></div><button className="icon-btn" onClick={onClose} aria-label="关闭"><X size={18} /></button></div>
        <div className="agent-editor-body">
          <AgentFields draft={draft} setDraft={setDraft} models={models} />
          <button className="send-btn full" onClick={() => void onSave(draft)}>保存 Agent</button>
        </div>
      </div>
    </div>
  );
}

function AgentFields({ draft, setDraft, models }: { draft: Agent; setDraft: (agent: Agent) => void; models: ModelProfile[] }) {
  const modelNames = Array.from(new Set([...models.map((model) => model.name), draft.model].filter(Boolean)));
  return (
    <div className="agent-fields">
      <label>名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label>
      <label>角色<input value={draft.role} onChange={(event) => setDraft({ ...draft, role: event.target.value })} /></label>
      <label>模型<select value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })}>{modelNames.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>颜色<input value={draft.color} onChange={(event) => setDraft({ ...draft, color: event.target.value })} /></label>
      <label>Soul<textarea value={draft.soul} onChange={(event) => setDraft({ ...draft, soul: event.target.value })} /></label>
      <label>职责范围<textarea value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value })} /></label>
    </div>
  );
}

function permissionCopy(mode: string) {
  return permissionDescription(mode);
}

function permissionLabel(mode: string) {
  if (mode === 'manual') return '请求批准';
  if (mode === 'smart') return '替我审批';
  return '完全访问权限';
}

function permissionDescription(mode: string) {
  if (mode === 'manual') return '编辑外部文件、执行命令和使用联网能力前先询问';
  if (mode === 'smart') return '仅对检测到的风险操作请求批准';
  return '允许 Hermes 直接访问互联网和本机文件，仍保留运行记录';
}

function permissionTone(mode: string) {
  if (mode === 'manual') return 'manual';
  if (mode === 'smart') return 'smart';
  return 'full';
}

function permissionIcon(mode: string) {
  if (mode === 'manual') return Hand;
  if (mode === 'smart') return ShieldCheck;
  return ShieldAlert;
}

function isVisibleChatMessage(message: ChatEvent) {
  const content = String(message.content || '');
  if (message.agentId === 'system') return false;
  if (message.agentName === 'Hermes Bridge') return false;
  if (/Local Fallback|检测到 Hermes Studio|没有可用的模型 API Key|已回退到本地模拟/.test(`${message.role} ${content}`)) return false;
  if (/^(已开启普通对话|已开启与 .+ 的单 Agent 对话|项目已创建|新项目对话已创建|Workspace 已开启)/.test(content)) return false;
  return true;
}

function slugText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-').replace(/^-+|-+$/g, '') || 'new-project';
}

function normalizeSpaceThemePalette(theme?: Partial<SpaceThemePalette>, fallback: SpaceThemePalette = defaultProductSpaceTheme): SpaceThemePalette {
  const accentColor = /^#[0-9a-fA-F]{6}$/.test(theme?.accentColor || '') ? theme!.accentColor! : fallback.accentColor;
  const sidebarBg = /^#[0-9a-fA-F]{6}$/.test(theme?.sidebarBg || '') ? theme!.sidebarBg! : fallback.sidebarBg;
  const texture = clampNumber(Number(theme?.texture ?? (theme?.noise == null ? fallback.texture || 0 : theme.noise / 0.35)), 0, 1);
  return {
    accentColor,
    sidebarBg,
    opacity: clampNumber(Number(theme?.opacity ?? fallback.opacity), 0.3, 0.9),
    noise: clampNumber(Number(theme?.noise ?? (texture * 0.35)), 0, 0.35),
    texture,
    mode: theme?.mode === 'crisp' ? 'crisp' : fallback.mode,
    gradientColors: normalizeGradientColors({ ...theme, accentColor, sidebarBg }),
  };
}

function deriveDarkThemePalette(theme: SpaceThemePalette): SpaceThemePalette {
  const colors = normalizeGradientColors(theme).map((color) => ({
    ...color,
    color: mixHexWithColor(color.color, '#11131a', 0.46),
  }));
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  return {
    ...theme,
    accentColor: primary?.color || mixHexWithColor(theme.accentColor, '#11131a', 0.46),
    sidebarBg: mixHexWithColor(theme.sidebarBg || theme.accentColor, '#12151c', 0.68),
    opacity: clampNumber(Math.max(theme.opacity, 0.76), 0.3, 0.9),
    mode: 'crisp',
    gradientColors: colors,
  };
}

function normalizeSpaceTheme(theme?: Partial<SpaceTheme>): SpaceTheme {
  const appearance: SpaceThemeAppearance = theme?.appearance === 'auto' || theme?.appearance === 'dark' || theme?.appearance === 'light' ? theme.appearance : 'light';
  const legacyPalette = normalizeSpaceThemePalette(theme as Partial<SpaceThemePalette> | undefined);
  const lightTheme = normalizeSpaceThemePalette(theme?.lightTheme || legacyPalette, legacyPalette);
  const darkTheme = normalizeSpaceThemePalette(theme?.darkTheme || deriveDarkThemePalette(lightTheme), deriveDarkThemePalette(lightTheme));
  const activePalette = appearance === 'dark' ? darkTheme : legacyPalette;
  return { ...activePalette, appearance, lightTheme, darkTheme };
}

function isThemeNightTime(date = new Date()) {
  const hour = date.getHours();
  return hour >= 18 || hour < 6;
}

function resolveEffectiveSpaceTheme(theme?: Partial<SpaceTheme>) {
  const normalized = normalizeSpaceTheme(theme);
  if (normalized.appearance === 'dark') return { ...normalized.darkTheme!, appearance: normalized.appearance, lightTheme: normalized.lightTheme, darkTheme: normalized.darkTheme };
  if (normalized.appearance === 'auto' && isThemeNightTime()) return { ...normalized.darkTheme!, appearance: normalized.appearance, lightTheme: normalized.lightTheme, darkTheme: normalized.darkTheme };
  return { ...normalized.lightTheme!, appearance: normalized.appearance, lightTheme: normalized.lightTheme, darkTheme: normalized.darkTheme };
}

function withDraftThemePalette(theme: SpaceTheme, palette: SpaceThemePalette): SpaceTheme {
  const normalized = normalizeSpaceTheme(theme);
  const editsDark = normalized.appearance === 'dark' || (normalized.appearance === 'auto' && isThemeNightTime());
  const lightTheme = editsDark ? normalized.lightTheme! : palette;
  const darkTheme = editsDark ? palette : normalized.darkTheme || deriveDarkThemePalette(palette);
  return { ...palette, appearance: normalized.appearance, lightTheme, darkTheme };
}

function normalizeGradientColors(theme?: Partial<SpaceTheme>): SpaceGradientColor[] {
  const source = Array.isArray(theme?.gradientColors) ? theme!.gradientColors! : [];
  const valid = source
    .filter((color) => /^#[0-9a-fA-F]{6}$/.test(color.color || ''))
    .slice(0, 3)
    .map((color, index) => ({
      id: String(color.id || `color_${index}`),
      color: color.color,
      x: clampNumber(Number(color.x ?? (index === 0 ? 0.18 : index === 1 ? 0.62 : 0.38)), 0, 1),
      y: clampNumber(Number(color.y ?? (index === 0 ? 0.72 : index === 1 ? 0.28 : 0.27)), 0, 1),
      isPrimary: Boolean(color.isPrimary),
    }));
  if (!valid.length) {
    valid.push({
      id: 'primary',
      color: /^#[0-9a-fA-F]{6}$/.test(theme?.accentColor || '') ? theme!.accentColor! : '#8b8cf6',
      x: 0.18,
      y: 0.72,
      isPrimary: true,
    });
  }
  const primaryIndex = Math.max(0, valid.findIndex((color) => color.isPrimary));
  return valid.map((color, index) => ({ ...color, isPrimary: index === primaryIndex }));
}

function primaryGradientColor(theme?: Partial<SpaceTheme>) {
  const colors = normalizeGradientColors(theme);
  return colors.find((color) => color.isPrimary) || colors[0];
}

function syncThemeFromGradientColors(theme: SpaceTheme): SpaceTheme {
  const gradientColors = normalizeGradientColors(theme);
  const primary = gradientColors.find((color) => color.isPrimary) || gradientColors[0];
  return {
    ...theme,
    accentColor: primary.color,
    sidebarBg: mixHexWithWhite(primary.color, theme.mode === 'crisp' ? 0.66 : 0.78),
    noise: clampNumber(Number(theme.noise ?? (theme.texture ?? 0) * 0.35), 0, 0.35),
    texture: clampNumber(Number(theme.texture ?? (theme.noise == null ? 0 : theme.noise / 0.35)), 0, 1),
    gradientColors,
  };
}

function updateSpaceThemeColorPoint(theme: SpaceTheme, colorId: string, x: number, y: number, nextColor = colorFromThemePoint(x, y)): SpaceTheme {
  const currentColors = normalizeGradientColors(theme);
  const movedColor = currentColors.find((color) => color.id === colorId);
  const movedColors = currentColors.map((color) => color.id === colorId ? { ...color, x, y, color: nextColor } : color);
  const gradientColors = movedColor?.isPrimary ? calculateHarmonyColors(movedColors, 'update') : movedColors;
  return syncThemeFromGradientColors({ ...theme, gradientColors });
}

function promoteGradientColor(theme: SpaceTheme, colorId: string): SpaceTheme {
  const colors = normalizeGradientColors(theme);
  const promoted = colors.find((color) => color.id === colorId);
  if (!promoted?.id) return syncThemeFromGradientColors({ ...theme, gradientColors: colors });
  const gradientColors = calculateHarmonyColors(colors.map((color) => ({ ...color, isPrimary: color.id === colorId })), 'update');
  return syncThemeFromGradientColors({ ...theme, gradientColors });
}

function buildSpaceThemeFromPoint(x: number, y: number, color = colorFromThemePoint(x, y), mode: SpaceTheme['mode'] = 'soft'): SpaceTheme {
  return {
    accentColor: color,
    sidebarBg: mixHexWithWhite(color, mode === 'crisp' ? 0.66 : 0.78),
    opacity: 0.9,
    noise: 0,
    texture: 0,
    mode,
    gradientColors: [{ id: 'primary', color, x, y, isPrimary: true }],
  };
}

function buildPresetGradientColors(colors: string[], point: { x: number; y: number }, harmony: ThemeHarmony, type: ThemePreset['type'] = 'color'): SpaceGradientColor[] {
  const primary = colors[0] || '#8d9bb8';
  if (colors.length === 1) return [{ id: 'primary', color: primary, x: point.x, y: point.y, isPrimary: true }];
  const positioned = calculateHarmonyColors([
    { id: 'primary', color: primary, x: point.x, y: point.y, isPrimary: true },
    { id: 'secondary_a', color: colors[1] || primary, x: point.x, y: point.y },
    { id: 'secondary_b', color: colors[2] || primary, x: point.x, y: point.y },
  ], 'update', harmony);
  return positioned.map((color, index) => ({ ...color, color: colors[index] || primary, id: index === 0 ? 'primary' : `secondary_${index}` }));
}

function clampThemePointToSquare(xValue: number, yValue: number) {
  return {
    x: clampNumber(Number.isFinite(xValue) ? xValue : 0.5, 0, 1),
    y: clampNumber(Number.isFinite(yValue) ? yValue : 0.5, 0, 1),
  };
}

function wavePathForOpacity(opacity: number) {
  const progress = opacityProgress(opacity);
  const startX = 51.373;
  const endX = 419.634;
  const centerY = 27.395;
  if (progress < 0.03) return 'M 51.373 27.395 L 419.634 27.395';
  const amp = 35.898 * progress;
  const segmentCount = 14;
  const segmentWidth = (endX - startX) / segmentCount;
  const segments = Array.from({ length: segmentCount }, (_, index) => {
    const x0 = startX + segmentWidth * index;
    const x1 = startX + segmentWidth * (index + 1);
    const y = centerY + (index % 2 === 0 ? -amp : amp);
    return `C ${(x0 + segmentWidth / 3).toFixed(3)} ${y.toFixed(3)} ${(x0 + segmentWidth * 2 / 3).toFixed(3)} ${y.toFixed(3)} ${x1.toFixed(3)} ${centerY}`;
  });
  return `M ${startX} ${centerY} ${segments.join(' ')}`;
}

function opacityProgress(opacity: number) {
  return clampNumber((opacity - 0.3) / 0.6, 0, 1);
}

function calculateHarmonyColors(colors: SpaceGradientColor[], action: 'add' | 'remove' | 'update' = 'update', harmony?: ThemeHarmony) {
  const normalized = normalizeGradientColors({ gradientColors: colors });
  const targetCount = clampNumber(action === 'add' ? normalized.length + 1 : normalized.length, 1, 3);
  const primary = normalized.find((color) => color.isPrimary) || normalized[0];
  const center = { x: 0.5, y: 0.5 };
  const dx = primary.x - center.x;
  const dy = primary.y - center.y;
  const radius = clampNumber(Math.sqrt(dx * dx + dy * dy), 0, 0.5);
  const baseAngle = Math.atan2(dy, dx);
  const nextColors: SpaceGradientColor[] = [{ ...primary, isPrimary: true }];
  const secondaries = normalized.filter((color) => !color.isPrimary);
  const activeHarmony: ThemeHarmony = harmony || (targetCount === 1 ? 'floating' : targetCount === 2 ? 'complementary' : 'splitComplementary');
  const angleOffsets = targetCount === 2
    ? [activeHarmony === 'singleAnalogous' ? 310 : 180]
    : targetCount === 3
      ? activeHarmony === 'analogous' ? [50, 310] : activeHarmony === 'triadic' ? [120, 240] : [150, 210]
      : [];
  angleOffsets.forEach((offset, index) => {
    const angle = baseAngle + offset * Math.PI / 180;
    const point = clampThemePointToSquare(center.x + radius * Math.cos(angle), center.y + radius * Math.sin(angle));
    const existing = secondaries[index];
    nextColors.push({
      id: existing?.id || `secondary_${index + 1}`,
      color: colorFromThemePoint(point.x, point.y),
      x: point.x,
      y: point.y,
      isPrimary: false,
    });
  });
  return nextColors;
}

function textureStepDots(texture = 0) {
  const activeValue = Math.round(clampNumber(texture, 0, 1) * 16) / 16;
  return Array.from({ length: 16 }, (_, index) => {
    const angle = index / 16 * Math.PI * 2;
    let order = index + 4;
    if (order >= 16) order -= 16;
    return {
      id: index,
      left: 50 + Math.cos(angle) * 50,
      top: 50 + Math.sin(angle) * 50,
      active: activeValue > 0 && order > 0 && order / 16 <= activeValue,
    };
  });
}

function textureHandleStyle(texture = 0) {
  const value = clampNumber(texture, 0, 1);
  const rotation = value * 360 - 90;
  const top = Math.sin(rotation * Math.PI / 180) * 50 + 50;
  const left = Math.cos(rotation * Math.PI / 180) * 50 + 50;
  return { left: `${left}%`, top: `${top}%`, transform: `translate(-50%, -50%) rotate(${rotation + 90}deg)` };
}

function themeGradientBackground(theme: SpaceTheme) {
  return themeZenGradientBackground(theme, 'picker');
}

function themeStageBackground(theme: SpaceTheme) {
  return themeZenGradientBackground(theme, 'stage');
}

function themeShellBackground(theme: SpaceTheme) {
  return themeZenGradientBackground(theme, 'shell');
}

function themeZenGradientBackground(theme: SpaceTheme, surface: 'picker' | 'stage' | 'shell') {
  const colors = normalizeGradientColors(theme);
  if (isNeutralProductTheme(theme)) {
    if (surface === 'stage') return 'radial-gradient(circle at 68% 18%, rgb(225 232 255 / 34%) 0%, transparent 34%), radial-gradient(circle at 10% 4%, rgb(220 235 228 / 42%) 0%, transparent 38%), #fafbfa';
    if (surface === 'shell') return 'linear-gradient(135deg, #f2f7f4 0%, #fafbfa 48%, #f5f7fb 100%)';
    return 'radial-gradient(circle at 16% 10%, rgb(214 231 223 / 72%) 0%, transparent 54%), #f5f8f6';
  }
  const base = themeGradientBase(theme, surface);
  if (colors.length <= 1) {
    const primary = softenThemeGradientColor(colors[0]?.color || theme.accentColor, theme, surface);
    return [
      `radial-gradient(circle at 12% 0%, ${primary} 0%, transparent ${surface === 'stage' ? '74%' : '68%'})`,
      base,
    ].join(', ');
  }
  if (colors.length === 2) {
    const first = softenThemeGradientColor(colors[0].color, theme, surface);
    const second = softenThemeGradientColor(colors[1].color, theme, surface);
    return [
      `linear-gradient(-45deg, ${second} 0%, transparent 100%)`,
      `linear-gradient(135deg, ${first} 0%, transparent 100%)`,
      base,
    ].join(', ');
  }
  const first = softenThemeGradientColor(colors[0].color, theme, surface);
  const second = softenThemeGradientColor(colors[1].color, theme, surface);
  const third = softenThemeGradientColor(colors[2].color, theme, surface);
  return [
    `linear-gradient(-5deg, ${third} 10%, transparent 80%)`,
    `radial-gradient(circle at 95% 0%, ${second} 0%, transparent 75%)`,
    `radial-gradient(circle at 0% 0%, ${first} 10%, transparent 70%)`,
    base,
  ].join(', ');
}

function themeRailBackground(theme: SpaceTheme) {
  const colors = normalizeGradientColors(theme);
  if (isNeutralProductTheme(theme)) {
    return 'linear-gradient(180deg, rgb(249 252 250 / 76%), rgb(239 246 242 / 68%)), rgb(243 247 245 / 58%)';
  }
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  const primaryColor = primary?.color || theme.accentColor;
  const progress = themeOpacityProgress(theme);
  const railPrimary = softenThemeGradientColor(primaryColor, theme, 'rail');
  const railChrome = mixHexWithColor(primaryColor, '#15181d', theme.mode === 'crisp' ? 0.24 : 0.3);
  const railMist = mixHexWithColor(theme.sidebarBg || primaryColor, '#f2ece3', 0.42);
  const railBase = mixHexWithColor(railMist, railChrome, 0.34 + progress * 0.52);
  const railLift = mixHexWithColor(railPrimary, progress < 0.5 ? '#fbf4ed' : '#ffffff', 0.3 - progress * 0.12);
  const glowStrength = Math.round(18 + progress * 20);
  const baseStrength = Math.round(42 + progress * 34);
  if (colors.length <= 1) {
    return [
      `linear-gradient(180deg, color-mix(in srgb, ${railLift} ${glowStrength + 8}%, transparent) 0%, color-mix(in srgb, ${railBase} ${baseStrength + 16}%, transparent) 100%)`,
      `color-mix(in srgb, ${railPrimary} ${24 + Math.round(progress * 24)}%, transparent)`,
    ].join(', ');
  }
  if (colors.length === 2) {
    const secondary = mixHexWithColor(softenThemeGradientColor(colors[1].color, theme, 'rail'), railBase, 0.34 + progress * 0.2);
    return [
      `radial-gradient(circle at 88% 4%, color-mix(in srgb, ${secondary} ${glowStrength + 4}%, transparent) 0%, transparent 62%)`,
      `linear-gradient(180deg, color-mix(in srgb, ${railLift} ${glowStrength + 6}%, transparent) 0%, color-mix(in srgb, ${railBase} ${baseStrength + 16}%, transparent) 100%)`,
      `color-mix(in srgb, ${railBase} ${baseStrength}%, transparent)`,
    ].join(', ');
  }
  const secondaryA = mixHexWithColor(softenThemeGradientColor(colors[1].color, theme, 'rail'), railBase, 0.38 + progress * 0.18);
  const secondaryB = mixHexWithColor(softenThemeGradientColor(colors[2].color, theme, 'rail'), railBase, 0.42 + progress * 0.16);
  return [
    `radial-gradient(circle at 86% 0%, color-mix(in srgb, ${secondaryA} ${glowStrength + 4}%, transparent) 0%, transparent 58%)`,
    `radial-gradient(circle at 4% 92%, color-mix(in srgb, ${secondaryB} ${glowStrength}%, transparent) 0%, transparent 56%)`,
    `linear-gradient(180deg, color-mix(in srgb, ${railLift} ${glowStrength + 6}%, transparent) 0%, color-mix(in srgb, ${railBase} ${baseStrength + 14}%, transparent) 100%)`,
    `color-mix(in srgb, ${railBase} ${baseStrength}%, transparent)`,
  ].join(', ');
}

function isNeutralProductTheme(theme: Partial<SpaceTheme>) {
  const colors = normalizeGradientColors(theme);
  return colors.length === 1
    && String(colors[0]?.color || '').toLowerCase() === '#dce8e3'
    && String(theme.sidebarBg || '').toLowerCase() === '#f3f7f5';
}

function themeGradientBase(theme: SpaceTheme, surface: 'picker' | 'stage' | 'shell') {
  const colors = normalizeGradientColors(theme);
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  const anchor = primary?.color || theme.accentColor;
  const progress = themeOpacityProgress(theme);
  const warmBase = surface === 'stage' ? '#f7f2ee' : surface === 'shell' ? '#f4efe7' : '#f1ebe2';
  const tintSource = mixHexWithColor(anchor, theme.sidebarBg || anchor, surface === 'picker' ? 0.24 : 0.34);
  const lowTint = surface === 'picker' ? 0.18 : surface === 'shell' ? 0.14 : 0.1;
  const highTint = surface === 'picker' ? 0.74 : surface === 'shell' ? 0.66 : 0.5;
  const tintRatio = lowTint + progress * (highTint - lowTint);
  const colorBase = mixHexWithColor(warmBase, tintSource, tintRatio);
  const percent = Math.round((surface === 'picker' ? 72 : surface === 'shell' ? 82 : 60) + progress * (surface === 'stage' ? 12 : 8));
  return `color-mix(in srgb, ${colorBase} ${percent}%, ${warmBase})`;
}

function softenThemeGradientColor(color: string, theme: SpaceTheme, surface: 'picker' | 'stage' | 'rail' | 'shell') {
  const opacityProgress = themeOpacityProgress(theme);
  const isCrisp = theme.mode === 'crisp';
  const strength = surface === 'rail'
    ? 0.34 + opacityProgress * 0.48 + (isCrisp ? 0.06 : 0)
    : surface === 'stage'
      ? 0.18 + opacityProgress * 0.5 + (isCrisp ? 0.06 : 0)
      : surface === 'shell'
        ? 0.24 + opacityProgress * 0.54 + (isCrisp ? 0.06 : 0)
        : 0.38 + opacityProgress * 0.5 + (isCrisp ? 0.08 : 0);
  const base = surface === 'rail'
    ? mixHexWithColor(theme.sidebarBg || color, opacityProgress > 0.55 ? '#16191f' : '#f1e9df', 0.5 - opacityProgress * 0.18)
    : mixHexWithColor(theme.sidebarBg || color, surface === 'stage' ? '#f8f2ee' : '#f5eee6', surface === 'picker' ? 0.62 : 0.72);
  return mixHexWithColor(color, base, 1 - clampNumber(strength, 0.12, 0.9));
}

function themeOpacityProgress(theme: Pick<SpaceTheme, 'opacity'>) {
  return clampNumber((Number(theme.opacity) - 0.3) / 0.6, 0, 1);
}

function spaceIconKind(space: Space): SpaceIconKind {
  if (space.iconKind === 'dot') return 'dot';
  if (space.id === 'space_default' && space.iconKind === 'emoji' && space.iconValue === '✨') return 'dot';
  return space.iconKind;
}

function SpaceIconGlyph({ space }: { space: Space }) {
  const kind = spaceIconKind(space);
  if (kind === 'dot') return <span className="space-dot-glyph" />;
  if (kind === 'emoji') return <span>{space.iconValue || '✨'}</span>;
  return <Folder size={15} />;
}

function colorFromThemePoint(x: number, y: number) {
  const cx = clampNumber(x, 0, 1) - 0.5;
  const cy = clampNumber(y, 0, 1) - 0.5;
  const distance = Math.min(Math.sqrt(cx * cx + cy * cy) / 0.5, 1);
  let angle = Math.atan2(cy, cx) * 180 / Math.PI;
  if (angle < 0) angle += 360;
  const hue = Math.round(angle);
  const saturation = Math.round(48 + distance * 44);
  const lightness = Math.round(76 - distance * 32);
  return hslToHex(hue, saturation, lightness);
}

function hslToHex(h: number, s: number, l: number) {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  const [r1, g1, b1] = h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
      : h < 180 ? [0, c, x]
        : h < 240 ? [0, x, c]
          : h < 300 ? [x, 0, c]
            : [c, 0, x];
  return `#${[r1, g1, b1].map((channel) => Math.round((channel + m) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function mixHexWithWhite(hex: string, whiteRatio: number) {
  return mixHexWithColor(hex, '#ffffff', whiteRatio);
}

function mixHexWithColor(hex: string, targetHex: string, targetRatio: number) {
  const clean = String(hex || '').replace('#', '');
  const target = String(targetHex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean) || !/^[0-9a-fA-F]{6}$/.test(target)) return '#f3f4ff';
  const ratio = clampNumber(targetRatio, 0, 1);
  const rgb = [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)].map((part) => Number.parseInt(part, 16));
  const targetRgb = [target.slice(0, 2), target.slice(2, 4), target.slice(4, 6)].map((part) => Number.parseInt(part, 16));
  const mixed = rgb.map((channel, index) => Math.round(channel * (1 - ratio) + targetRgb[index] * ratio));
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, '0')).join('')}`;
}

function textureSurfaceVars(theme: SpaceTheme, surface: 'rail' | 'stage') {
  const colors = normalizeGradientColors(theme);
  const primary = colors.find((color) => color.isPrimary) || colors[0];
  const anchor = surface === 'rail' ? mixHexWithColor(primary?.color || theme.accentColor, '#171a1f', theme.mode === 'crisp' ? 0.34 : 0.42) : mixHexWithWhite(primary?.color || theme.accentColor, 0.68);
  const luminance = hexLuminance(anchor);
  const lightBias = clampNumber((luminance - 0.48) / 0.52, 0, 1);
  const darkBias = clampNumber((0.56 - luminance) / 0.56, 0, 1);
  const base = surface === 'rail' ? 0.48 : 0.38;
  return {
    '--texture-grain-opacity': String(base + lightBias * 0.2 + darkBias * 0.16),
    '--texture-grain-contrast': String(1.2 + lightBias * 0.55 + darkBias * 0.36),
    '--texture-haze-opacity': String((surface === 'rail' ? 0.36 : 0.28) + darkBias * 0.14),
  };
}

function hexLuminance(hex: string) {
  const clean = String(hex || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return 0.7;
  const channels = [clean.slice(0, 2), clean.slice(2, 4), clean.slice(4, 6)].map((part) => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function hexToRgb(value: string) {
  const clean = String(value || '').replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return '243 244 255';
  const r = Number.parseInt(clean.slice(0, 2), 16);
  const g = Number.parseInt(clean.slice(2, 4), 16);
  const b = Number.parseInt(clean.slice(4, 6), 16);
  return `${r} ${g} ${b}`;
}

function agentColor(agents: Agent[], id: string) {
  if (id === 'user') return '#0f172a';
  return agents.find((agent) => agent.id === id)?.color || '#64748b';
}

function modelForAgent(agent: Agent, models: ModelProfile[], overrides: AgentModelOverrides = {}, fallbackModelId = '') {
  const override = overrides[agent.id];
  return resolveModelChoice(override || '', models).model
    || resolveModelChoice(agent.model || '', models).model
    || resolveModelChoice(fallbackModelId || '', models).model
    || models[0]
    || null;
}

function hermesProfileModels(models: ModelProfile[]) {
  return models.filter((model) => model.baseUrl && modelNamesForProvider(model).length);
}

function resolveHermesProfileNameForAgent(agent: Agent | null, profiles: HermesProfile[]) {
  if (!agent) return profiles.some((profile) => profile.name === 'default') ? 'default' : profiles[0]?.name || 'default';
  if (agent.profileName && profiles.some((profile) => profile.name === agent.profileName)) return agent.profileName;
  if (profiles.some((profile) => profile.name === agent.id)) return agent.id;
  const normalizedName = agent.name.trim().toLowerCase();
  const byName = profiles.find((profile) => profile.name.toLowerCase() === normalizedName);
  if (byName) return byName.name;
  return profiles.some((profile) => profile.name === 'default') ? 'default' : profiles[0]?.name || 'default';
}

function modelValueForHermesProfile(profileName: string, profiles: HermesProfile[], models: ModelProfile[]) {
  const profile = profiles.find((item) => item.name === profileName);
  const provider = profile?.provider || '';
  const model = profile?.model || '';
  const exact = hermesProfileModels(models).find((item) => {
    const providerMatch = item.providerKey === provider || item.provider === provider || item.providerKey === provider.replace(/^custom:/, '') || `custom:${item.providerKey}` === provider;
    return providerMatch && modelNamesForProvider(item).includes(model);
  });
  if (exact) return modelChoiceValue(exact, model);
  const sameModel = hermesProfileModels(models).find((item) => modelNamesForProvider(item).includes(model));
  if (sameModel) return modelChoiceValue(sameModel, model);
  return '';
}

function profileModelLabel(profileName: string, profiles: HermesProfile[]) {
  const profile = profiles.find((item) => item.name === profileName);
  if (!profile) return `${profileName} · 未发现 Profile`;
  return `${profile.name} · ${profile.provider || 'provider default'} / ${profile.model || 'provider default'}`;
}

function formatHermesRuntimeError(message: string, profileName = 'default', details?: { command?: string; serverName?: string; missingExecutable?: boolean }) {
  if (/No Codex credentials stored|hermes auth/i.test(message)) {
    return `当前 Hermes Profile「${profileName}」使用 openai-codex，但本机未完成 hermes auth。请在右下角切换到 DeepSeek 等已配置模型，或运行 hermes auth 后重试。`;
  }
  const missingCommand = details?.command
    || message.match(/找不到命令「([^」]+)」/)?.[1]
    || message.match(/No such file or directory:\s*['"]([^'"]+)['"]/i)?.[1]
    || message.match(/requires\s+([A-Za-z0-9_.-]+), but/i)?.[1]
    || '';
  if (missingCommand) {
    const server = details?.serverName || message.match(/MCP server[「'\s]+([^」'\s]+)[」']?/i)?.[1] || message.match(/MCP server「([^」]+)」/)?.[1] || '';
    return `当前 Hermes Profile「${profileName}」的${server ? ` ${server} ` : ' '}MCP 启动失败：找不到 ${missingCommand}。请安装 Node/npm，或把 MCP command 改成绝对路径。`;
  }
  if (details?.missingExecutable || /FileNotFoundError|No such file or directory|\[Errno 2\]/i.test(message)) {
    const server = details?.serverName ? ` ${details.serverName} ` : ' ';
    return `当前 Hermes Profile「${profileName}」的${server}MCP 启动失败：找不到运行依赖。请检查 Node/npm/npx 或 MCP command 绝对路径。`;
  }
  return message;
}

function modelValueForAgent(agent: Agent, models: ModelProfile[], overrides: AgentModelOverrides = {}, fallbackModelId = '') {
  const override = overrides[agent.id];
  if (override && resolveModelChoice(override, models).model) return resolveModelChoice(override, models).value;
  const direct = resolveModelChoice(agent.model || '', models);
  if (direct.model) return direct.value;
  const fallback = resolveModelChoice(fallbackModelId || '', models);
  if (fallback.model) return fallback.value;
  const first = models[0];
  return first ? modelChoiceValue(first, first.model) : '';
}

function agentDefaultModelLabel(agent: Agent, models: ModelProfile[]) {
  const value = modelValueForAgent(agent, models);
  const choice = resolveModelChoice(value, models);
  return choice.modelName || choice.model?.model || agent.model || '未配置模型';
}

function agentSessionModelLabel(agent: Agent, models: ModelProfile[], overrides: AgentModelOverrides = {}, fallbackModelId = '') {
  const override = overrides[agent.id];
  if (override) {
    const resolved = resolveModelChoice(override, models);
    return resolved.model ? `${resolved.model.name} · ${resolved.modelName || resolved.model.model}` : '已覆盖';
  }
  const resolved = modelForAgent(agent, models, overrides, fallbackModelId);
  const value = modelValueForAgent(agent, models, overrides, fallbackModelId);
  const choice = resolveModelChoice(value, models);
  return choice.model ? `${choice.model.name} · ${choice.modelName || choice.model.model}` : resolved?.name || agent.model || '未配置模型';
}

function buildMentionOptions(agents: Agent[], selectedAgentIds: string[], query: string): MentionOption[] {
  const normalizedQuery = query.trim().toLowerCase();
  const selectedSet = new Set(selectedAgentIds);
  const options: MentionOption[] = [];
  if (!normalizedQuery || 'all'.includes(normalizedQuery)) {
    options.push({ key: 'special:all', type: 'all', name: 'all', label: '@all', description: '当前房间全部 Agent' });
  }
  const sortedAgents = [...agents].sort((a, b) => Number(selectedSet.has(b.id)) - Number(selectedSet.has(a.id)) || a.name.localeCompare(b.name));
  for (const agent of sortedAgents) {
    const searchable = [agent.name, agent.id, agent.profileName, agent.role].filter(Boolean).join(' ').toLowerCase();
    if (normalizedQuery && !searchable.includes(normalizedQuery)) continue;
    options.push({
      key: `agent:${agent.id}`,
      type: 'agent',
      name: agent.name,
      label: `@${agent.name}`,
      description: `${selectedSet.has(agent.id) ? '当前房间 · ' : ''}${agent.role || agent.profileName || agent.model || 'Agent'}`,
      agent,
    });
  }
  return options;
}

const mentionBeforeBoundaryChars = new Set(['(', '[', '{', '<']);
const mentionAfterBoundaryChars = new Set(['.', ',', '!', '?', ';', ':', '，', '。', '！', '？', '；', '：', ')', ']', '}', '>']);

function isMentionBeforeBoundary(char: string | undefined) {
  return char === undefined || /\s/.test(char) || mentionBeforeBoundaryChars.has(char);
}

function isMentionAfterBoundary(char: string | undefined) {
  return char === undefined || /\s/.test(char) || mentionAfterBoundaryChars.has(char);
}

function mentionIndex(content: string, mentionName: string) {
  const raw = String(content || '');
  const name = String(mentionName || '').trim();
  if (!raw || !name) return -1;
  const lower = raw.toLowerCase();
  const needle = `@${name.toLowerCase()}`;
  let fromIndex = 0;
  while (fromIndex < lower.length) {
    const atIndex = lower.indexOf(needle, fromIndex);
    if (atIndex === -1) return -1;
    const end = atIndex + needle.length;
    if (isMentionBeforeBoundary(raw[atIndex - 1]) && isMentionAfterBoundary(raw[end])) return atIndex;
    fromIndex = atIndex + 1;
  }
  return -1;
}

function resolveRunTarget(message: string, agents: Agent[], fallbackAgent: Agent | null): ChatRunTarget | null {
  const allIndex = mentionIndex(message, 'all');
  const matches = agents
    .map((agent) => {
      const names = [agent.name, agent.id, agent.profileName].filter((name): name is string => Boolean(name));
      const indices = names.map((name) => mentionIndex(message, name)).filter((index) => index >= 0);
      return indices.length ? { agent, index: Math.min(...indices) } : null;
    })
    .filter(Boolean) as Array<{ agent: Agent; index: number }>;
  const firstAgentMatch = matches.sort((a, b) => a.index - b.index)[0];
  if (allIndex >= 0 && (!firstAgentMatch || allIndex <= firstAgentMatch.index)) return { kind: 'all', agent: fallbackAgent };
  if (firstAgentMatch) return { kind: 'agent', agent: firstAgentMatch.agent };
  return fallbackAgent ? { kind: 'agent', agent: fallbackAgent } : null;
}

function pruneAgentModelOverrides(overrides: AgentModelOverrides, agents: Agent[], models: ModelProfile[]) {
  const agentIds = new Set(agents.map((agent) => agent.id));
  return Object.fromEntries(Object.entries(overrides).filter(([agentId, modelId]) => agentIds.has(agentId) && Boolean(resolveModelChoice(modelId, models).model)));
}

function moduleEntryName(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? entry : entry.name;
}

function moduleEntryDescription(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? '' : entry.description || '';
}

function moduleEntryCategory(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? '' : entry.category || '';
}

function moduleEntryEnabled(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? true : entry.enabled !== false;
}

function moduleEntryStatus(entry: ProfileModuleEntry) {
  if (typeof entry === 'string') return 'installed';
  return entry.status || (entry.enabled === false ? 'disabled' : 'enabled');
}

function moduleEntryStatusLabel(entry: ProfileModuleEntry) {
  if (typeof entry === 'string') return '已安装';
  return entry.statusLabel || (entry.enabled === false ? '未启用' : '已启用');
}

function moduleEntrySource(entry: ProfileModuleEntry) {
  if (typeof entry === 'string') return '';
  return entry.source || '';
}

function moduleEntryUsage(entry: ProfileModuleEntry) {
  return typeof entry === 'string' ? {} : entry.usage || {};
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('文件读取失败。'));
    reader.readAsDataURL(file);
  });
}

function profileColor(profile: string) {
  const palette = ['#111827', '#0f766e', '#7c3aed', '#b45309', '#2563eb', '#475569', '#be123c', '#0369a1'];
  const total = String(profile || '').split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return palette[total % palette.length];
}

function formatFileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(Math.round(value || 0));
}

function formatFullNumber(value: number) {
  return Math.round(value || 0).toLocaleString('en-US');
}

function formatWanNumber(value: number) {
  const next = Number(value || 0);
  if (next >= 10_000) return `${(next / 10_000).toFixed(next >= 1_000_000 ? 2 : 1)} 万`;
  if (next >= 1_000) return `${(next / 1_000).toFixed(1)}K`;
  return String(Math.round(next));
}

function formatChineseApproxNumber(value: number) {
  const next = Number(value || 0);
  if (next >= 100_000_000) return `${trimTrailingZero(next / 100_000_000)} 亿`;
  if (next >= 10_000) return `${trimTrailingZero(next / 10_000)} 万`;
  return String(Math.round(next));
}

function trimTrailingZero(value: number) {
  return value.toFixed(1).replace(/\.0$/, '');
}

function formatUsd(value: number) {
  return `$${Number(value || 0).toFixed(value >= 10 ? 2 : 4)}`;
}

function formatTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function formatDuration(totalSeconds: number) {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!minutes) return `${rest}s`;
  return `${minutes}m ${rest}s`;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function ResizeHandle({ side, disabled, onResize, onCommit }: { side: 'left' | 'right'; disabled?: boolean; onResize: (width: number) => void; onCommit: (width: number) => void }) {
  const latestWidthRef = useRef(0);
  function startDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    event.preventDefault();
    const startX = event.clientX;
    const app = event.currentTarget.closest('.app') as HTMLElement | null;
    const sidebar = app?.querySelector('.sidebar, .settings-rail-sidebar') as HTMLElement | null;
    const context = app?.querySelector('.context') as HTMLElement | null;
    const startWidth = side === 'left'
      ? sidebar?.getBoundingClientRect().width || defaultSidebarWidth
      : context?.getBoundingClientRect().width || defaultContextWidth;
    const bounds = side === 'left' ? sidebarWidthBounds : contextWidthBounds;
    latestWidthRef.current = startWidth;
    document.body.classList.add('resizing-columns');
    const onMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = side === 'left' ? startWidth + delta : startWidth - delta;
      const clamped = clampNumber(nextWidth, bounds.min, bounds.max);
      latestWidthRef.current = clamped;
      onResize(clamped);
    };
    const onUp = () => {
      document.body.classList.remove('resizing-columns');
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      onCommit(latestWidthRef.current);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp, { once: true });
  }
  return <div className={`resize-handle ${side} ${disabled ? 'disabled' : ''}`} onPointerDown={startDrag} aria-hidden="true" />;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
