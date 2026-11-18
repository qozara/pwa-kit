export type AppUpdateCheckResult = 'update_available' | 'up_to_date' | 'offline' | 'error' | 'timeout';

export interface RegisterSWOptions {
  immediate?: boolean;
  onNeedRefresh?: () => void;
  onOfflineReady?: () => void;
  onRegistered?: (registration: ServiceWorkerRegistration | undefined) => void;
  onRegisteredSW?: (swUrl: string, registration: ServiceWorkerRegistration | undefined) => void;
  onRegisterError?: (error: unknown) => void;
}

export type RegisterSWFn = (
  options?: RegisterSWOptions
) => (reloadPage?: boolean) => Promise<void>;

export interface PwaUpdateState {
  needRefresh: boolean;
  offlineReady: boolean;
  isChecking: boolean;
  isUpdating: boolean;
  isPromptDismissed: boolean;
  lastCheckResult: AppUpdateCheckResult | null;
  currentVersion: string | undefined;
  availableVersion: string | null;
  requiresHardReloadRecovery: boolean;
}

export interface PwaUpdateConfig {
  /** Current compiled app version (e.g., injected via Vite define). */
  currentVersion?: string;
  /** Same-origin or relative URL path for the uncached build version JSON. Defaults to '/version.json'. */
  versionUrl?: string;
  /** Minimum milliseconds between automatic visibilitychange checks. Defaults to 15 minutes. */
  visibilityCooldownMs?: number;
  /** Timeout in milliseconds for fetching version.json. Defaults to 4000. */
  networkTimeoutMs?: number;
  /** Grace window in ms to let Service Worker `reg.update()` respond once version.json finishes. Defaults to 1500. */
  swGracePeriodMs?: number;
  /** Timeout in ms for Service Worker `getRegistration()` and `update()`. Defaults to 5000. */
  swTimeoutMs?: number;
  /** Maximum time in ms to wait for an installing SW to transition to installed during manual check. Defaults to 4000. */
  swInstallWaitMs?: number;
  /** Delay in ms before forcing window reload after posting SKIP_WAITING. Defaults to 500. */
  reloadFallbackMs?: number;
  /** Cache Storage name prefixes deleted during iOS self-healing recovery (preserves IndexedDB & storage). */
  recoverableCachePrefixes?: readonly string[];
  /** Optional callback fired when an update becomes available. */
  onUpdateAvailable?: (state: PwaUpdateState) => void;
  /** Optional callback fired after each update check settles. */
  onCheckComplete?: (result: AppUpdateCheckResult, state: PwaUpdateState) => void;
  /** Optional callback fired if Service Worker registration throws an error. */
  onRegisterError?: (error: unknown) => void;
  /** Optional custom reload callback (defaults to `window.location.reload()`). */
  onReload?: () => void;
  /** Optional custom fetch implementation (useful in tests). */
  fetchImpl?: typeof fetch;
}

export interface PwaUpdateContextValue extends PwaUpdateState {
  checkForUpdates: () => Promise<AppUpdateCheckResult>;
  applyUpdate: () => Promise<void>;
  dismissPrompt: () => void;
}
