export type ApiError = {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
};

export type ReleaseAsset = {
  name?: string;
  browser_download_url?: string;
  size?: number;
};

export type AppUpdateStatus = {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  channel: 'beta' | 'stable';
  repositoryUrl: string;
  releaseUrl: string;
  notes?: string;
  publishedAt?: string;
  asset?: ReleaseAsset | null;
  installMode: 'desktop-release' | 'source';
  error?: string;
};

export type RuntimePlatform = 'mac-arm64' | 'mac-x64' | 'win-arm64' | 'win-x64' | 'linux-arm64' | 'linux-x64';
