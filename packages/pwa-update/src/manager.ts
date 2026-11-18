import type {
  AppUpdateCheckResult,
  PwaUpdateConfig,
  PwaUpdateState,
  RegisterSWFn,
} from './types.js';

export const DEFAULT_VISIBILITY_COOLDOWN_MS = 15 * 60 * 1000;

export const DEFAULT_RECOVERABLE_CACHE_PREFIXES: readonly string[] = [
  'workbox-precache',
  'navigation-cache',
  'static-assets-cache',
  'vite-pwa',
];

type VersionCheckOutcome =
  | { kind: 'mismatch'; serverVersion: string }
  | { kind: 'match'; serverVersion: string }
  | { kind: 'timeout' }
  | { kind: 'error' }
  | { kind: 'unconfigured' };

type SwUpdateOutcome = 'waiting' | 'ok' | 'timeout' | 'error' | 'unsupported';

const DEFAULT_NETWORK_TIMEOUT_MS = 4000;
const DEFAULT_SW_GRACE_PERIOD_MS = 1500;
const DEFAULT_SW_TIMEOUT_MS = 5000;
const DEFAULT_SW_INSTALL_WAIT_MS = 4000;
const DEFAULT_RELOAD_FALLBACK_MS = 500;
const MAX_VERSION_STRING_LENGTH = 128;

function validateVersionUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('//')) {
    return null;
  }

  const hasScheme = /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(trimmed);
  if (!hasScheme) {
    return trimmed;
  }

  try {
    const parsed = new URL(trimmed);
    if (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      typeof window !== 'undefined' &&
      parsed.origin === window.location.origin
    ) {
      return parsed.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function appendCacheBuster(url: string): string {
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}_t=${Date.now()}`;
}

async function raceWithTimeout<T>(
  promise: Promise<T>,
  ms: number,
  onTimeoutValue: T
): Promise<{ settled: boolean; value: T }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise.then((value) => ({ settled: true, value })),
      new Promise<{ settled: boolean; value: T }>((resolve) => {
        timer = setTimeout(() => resolve({ settled: false, value: onTimeoutValue }), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}

export class PwaUpdateManager {
  private config: Required<
    Pick<
      PwaUpdateConfig,
      | 'versionUrl'
      | 'visibilityCooldownMs'
      | 'networkTimeoutMs'
      | 'swGracePeriodMs'
      | 'swTimeoutMs'
      | 'swInstallWaitMs'
      | 'reloadFallbackMs'
      | 'recoverableCachePrefixes'
    >
  > &
    Omit<
      PwaUpdateConfig,
      | 'versionUrl'
      | 'visibilityCooldownMs'
      | 'networkTimeoutMs'
      | 'swGracePeriodMs'
      | 'swTimeoutMs'
      | 'swInstallWaitMs'
      | 'reloadFallbackMs'
      | 'recoverableCachePrefixes'
    >;

  private state: PwaUpdateState;
  private listeners = new Set<() => void>();
  private swRegistration: ServiceWorkerRegistration | undefined;
  private updateSWFn: ((reloadPage?: boolean) => Promise<void>) | undefined;
  private boundRegistrations = new WeakSet<ServiceWorkerRegistration>();
  private boundInstallingWorkers = new WeakSet<ServiceWorker>();
  private lastVisibilityCheckTime = 0;
  private activeCleanup: (() => void) | null = null;
  private fallbackReloadTimer: ReturnType<typeof setTimeout> | null = null;
  private inFlightCheck: Promise<AppUpdateCheckResult> | null = null;

  constructor(config: PwaUpdateConfig = {}) {
    this.config = {
      versionUrl: '/version.json',
      visibilityCooldownMs: DEFAULT_VISIBILITY_COOLDOWN_MS,
      networkTimeoutMs: DEFAULT_NETWORK_TIMEOUT_MS,
      swGracePeriodMs: DEFAULT_SW_GRACE_PERIOD_MS,
      swTimeoutMs: DEFAULT_SW_TIMEOUT_MS,
      swInstallWaitMs: DEFAULT_SW_INSTALL_WAIT_MS,
      reloadFallbackMs: DEFAULT_RELOAD_FALLBACK_MS,
      recoverableCachePrefixes: DEFAULT_RECOVERABLE_CACHE_PREFIXES,
      ...config,
    };

    this.state = {
      needRefresh: false,
      offlineReady: false,
      isChecking: false,
      isUpdating: false,
      isPromptDismissed: false,
      lastCheckResult: null,
      currentVersion: config.currentVersion,
      availableVersion: null,
      requiresHardReloadRecovery: false,
    };
  }

  public getSnapshot = (): PwaUpdateState => {
    return this.state;
  };

  public subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private setState(partial: Partial<PwaUpdateState>): void {
    this.state = { ...this.state, ...partial };
    this.listeners.forEach((listener) => {
      try {
        listener();
      } catch (err) {
        console.warn('[PWA] State listener error:', err);
      }
    });
  }

  private performReload(): void {
    if (this.fallbackReloadTimer !== null) {
      clearTimeout(this.fallbackReloadTimer);
      this.fallbackReloadTimer = null;
    }

    if (this.config.onReload) {
      this.config.onReload();
      return;
    }

    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
      try {
        window.location.reload();
      } catch {
        // Ignore jsdom navigation guard errors
      }
    }
  }

  private notifyUpdateAvailable(
    overrides: Partial<
      Pick<PwaUpdateState, 'availableVersion' | 'requiresHardReloadRecovery' | 'isChecking'>
    > = {}
  ): void {
    const wasAlreadyReady = this.state.needRefresh;
    this.setState({
      needRefresh: true,
      isPromptDismissed: false,
      lastCheckResult: 'update_available',
      ...overrides,
    });
    if (!wasAlreadyReady) {
      this.config.onUpdateAvailable?.(this.state);
    }
  }

  private attachInstallingWorkerListener(
    worker: ServiceWorker,
    registration: ServiceWorkerRegistration
  ): void {
    if (this.boundInstallingWorkers.has(worker)) {
      return;
    }
    this.boundInstallingWorkers.add(worker);

    worker.addEventListener('statechange', () => {
      if (worker.state !== 'installed') {
        return;
      }
      const hasExistingWorker =
        registration.waiting === worker ||
        Boolean(typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) ||
        Boolean(registration.active && registration.active !== worker);

      if (hasExistingWorker) {
        this.notifyUpdateAvailable({ requiresHardReloadRecovery: false });
      }
    });
  }

  private bindRegistrationListeners(registration: ServiceWorkerRegistration): void {
    if (this.boundRegistrations.has(registration)) {
      return;
    }
    this.boundRegistrations.add(registration);

    if (registration.installing) {
      this.attachInstallingWorkerListener(registration.installing, registration);
    }

    if (typeof registration.addEventListener === 'function') {
      registration.addEventListener('updatefound', () => {
        if (registration.installing) {
          this.attachInstallingWorkerListener(registration.installing, registration);
        }
      });
    }
  }

  private async checkVersionManifest(): Promise<VersionCheckOutcome> {
    const currentVersion = this.config.currentVersion?.trim();
    if (!currentVersion) {
      return { kind: 'unconfigured' };
    }

    const safeUrl = validateVersionUrl(this.config.versionUrl);
    if (!safeUrl) {
      return { kind: 'error' };
    }

    const fetchFn = this.config.fetchImpl ?? (typeof fetch === 'function' ? fetch : undefined);
    if (!fetchFn) {
      return { kind: 'unconfigured' };
    }

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.config.networkTimeoutMs);

    try {
      const response = await fetchFn(appendCacheBuster(safeUrl), {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        return { kind: 'error' };
      }

      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('version' in data)) {
        return { kind: 'error' };
      }

      const rawVersion = (data as { version: unknown }).version;
      if (typeof rawVersion !== 'string') {
        return { kind: 'error' };
      }

      const serverVersion = rawVersion.trim();
      if (!serverVersion || serverVersion.length > MAX_VERSION_STRING_LENGTH) {
        return { kind: 'error' };
      }

      if (serverVersion !== currentVersion) {
        return { kind: 'mismatch', serverVersion };
      }

      return { kind: 'match', serverVersion };
    } catch {
      return timedOut ? { kind: 'timeout' } : { kind: 'error' };
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async waitForInstallingWorker(
    worker: ServiceWorker,
    registration: ServiceWorkerRegistration
  ): Promise<boolean> {
    if (worker.state === 'installed') {
      return Boolean(registration.waiting || navigator.serviceWorker?.controller || registration.active);
    }
    if (worker.state === 'redundant' || worker.state === 'activated') {
      return Boolean(registration.waiting);
    }

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const cleanup = () => {
        worker.removeEventListener('statechange', onStateChange);
      };

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve(worker.state === 'installed' || Boolean(registration.waiting));
        }
      }, this.config.swInstallWaitMs);

      const onStateChange = () => {
        if (settled) return;
        if (worker.state === 'installed') {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(true);
        } else if (worker.state === 'redundant' || worker.state === 'activated') {
          settled = true;
          clearTimeout(timer);
          cleanup();
          resolve(Boolean(registration.waiting));
        }
      };

      worker.addEventListener('statechange', onStateChange);
    });
  }

  private async runSwUpdate(): Promise<SwUpdateOutcome> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return 'unsupported';
    }

    let reg = this.swRegistration;
    if (!reg && typeof navigator.serviceWorker.getRegistration === 'function') {
      const regRace = await raceWithTimeout(
        navigator.serviceWorker.getRegistration().catch(() => undefined),
        this.config.swTimeoutMs,
        undefined
      );
      if (!regRace.settled) {
        return 'timeout';
      }
      reg = regRace.value;
      if (reg) {
        this.swRegistration = reg;
        this.bindRegistrationListeners(reg);
      }
    }

    if (!reg || typeof reg.update !== 'function') {
      return 'unsupported';
    }

    if (reg.waiting) {
      return 'waiting';
    }

    try {
      const updateRace = await raceWithTimeout(reg.update(), this.config.swTimeoutMs, undefined);
      if (!updateRace.settled) {
        return 'timeout';
      }
    } catch {
      return 'error';
    }

    if (reg.waiting || this.swRegistration?.waiting) {
      return 'waiting';
    }

    const installingWorker = reg.installing || this.swRegistration?.installing;
    if (installingWorker) {
      this.attachInstallingWorkerListener(installingWorker, reg);
      const installed = await this.waitForInstallingWorker(installingWorker, reg);
      if (installed || reg.waiting || this.swRegistration?.waiting) {
        return 'waiting';
      }
    }

    return this.state.needRefresh ? 'waiting' : 'ok';
  }

  private async runForegroundResumeCheck(): Promise<void> {
    const manifestPromise = this.checkVersionManifest();
    if (this.swRegistration && typeof this.swRegistration.update === 'function') {
      void this.swRegistration.update().catch((err) => {
        console.warn('[PWA] Foreground visibility update check failed:', err);
      });
    }

    const manifestResult = await manifestPromise;
    if (manifestResult.kind === 'mismatch' && !this.state.needRefresh) {
      this.notifyUpdateAvailable({
        availableVersion: manifestResult.serverVersion,
        requiresHardReloadRecovery: !this.swRegistration?.waiting,
      });
    }
  }

  public register(registerSWImpl: RegisterSWFn): () => void {
    if (this.activeCleanup) {
      this.activeCleanup();
      this.activeCleanup = null;
    }

    this.lastVisibilityCheckTime = Date.now();

    this.updateSWFn = registerSWImpl({
      immediate: true,
      onRegisteredSW: (_swUrl, registration) => {
        if (!registration) {
          return;
        }
        this.swRegistration = registration;
        this.bindRegistrationListeners(registration);
        if (registration.waiting) {
          this.notifyUpdateAvailable({ requiresHardReloadRecovery: false });
        }
      },
      onNeedRefresh: () => {
        this.notifyUpdateAvailable({ requiresHardReloadRecovery: false });
      },
      onOfflineReady: () => {
        this.setState({ offlineReady: true });
      },
      onRegisterError: (error) => {
        console.warn('[PWA] Service Worker registration error:', error);
        this.config.onRegisterError?.(error);
      },
    });

    const handleVisibilityChange = () => {
      if (typeof document === 'undefined' || document.visibilityState !== 'visible') {
        return;
      }
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        return;
      }
      const now = Date.now();
      if (now - this.lastVisibilityCheckTime < this.config.visibilityCooldownMs) {
        return;
      }
      this.lastVisibilityCheckTime = now;
      void this.runForegroundResumeCheck();
    };

    const handlePreloadError = () => {
      this.performReload();
    };

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('vite:preloadError', handlePreloadError);
    }

    const cleanup = () => {
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange);
      }
      if (typeof window !== 'undefined') {
        window.removeEventListener('vite:preloadError', handlePreloadError);
      }
      if (this.activeCleanup === cleanup) {
        this.activeCleanup = null;
      }
    };

    this.activeCleanup = cleanup;
    return cleanup;
  }

  private finishWithUpdateAvailable(
    overrides: Partial<
      Pick<PwaUpdateState, 'availableVersion' | 'requiresHardReloadRecovery'>
    > = {}
  ): AppUpdateCheckResult {
    const shouldNotify = !this.state.needRefresh || this.state.isPromptDismissed;
    this.setState({
      needRefresh: true,
      isPromptDismissed: false,
      isChecking: false,
      lastCheckResult: 'update_available',
      ...overrides,
    });
    if (shouldNotify) {
      this.config.onUpdateAvailable?.(this.state);
    }
    this.config.onCheckComplete?.('update_available', this.state);
    return 'update_available';
  }

  public checkForUpdates = async (): Promise<AppUpdateCheckResult> => {
    if (this.inFlightCheck) {
      return this.inFlightCheck;
    }

    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.setState({ lastCheckResult: 'offline' });
      this.config.onCheckComplete?.('offline', this.state);
      return 'offline';
    }

    if (this.state.needRefresh || this.swRegistration?.waiting) {
      return this.finishWithUpdateAvailable();
    }

    this.setState({ isChecking: true, lastCheckResult: null });

    const runCheck = async (): Promise<AppUpdateCheckResult> => {
      try {
        this.lastVisibilityCheckTime = Date.now();

        const versionPromise = this.checkVersionManifest();
        const swPromise = this.runSwUpdate();

        const versionResult = await versionPromise;

        // If onNeedRefresh() or updatefound resolved while fetching version.json
        if (this.state.needRefresh || this.swRegistration?.waiting) {
          return this.finishWithUpdateAvailable({
            availableVersion:
              versionResult.kind === 'mismatch'
                ? versionResult.serverVersion
                : this.state.availableVersion,
            requiresHardReloadRecovery: false,
          });
        }

        if (versionResult.kind === 'mismatch') {
          await raceWithTimeout(swPromise, this.config.swGracePeriodMs, 'timeout' as const);
          const hasWaitingSw = Boolean(this.swRegistration?.waiting);
          return this.finishWithUpdateAvailable({
            availableVersion: versionResult.serverVersion,
            requiresHardReloadRecovery: !hasWaitingSw,
          });
        }

        let swOutcome: SwUpdateOutcome;
        if (versionResult.kind === 'match') {
          const graceRace = await raceWithTimeout(
            swPromise,
            this.config.swGracePeriodMs,
            'timeout' as const
          );
          swOutcome = graceRace.value;
        } else {
          swOutcome = await swPromise;
        }

        if (this.state.needRefresh || this.swRegistration?.waiting || swOutcome === 'waiting') {
          return this.finishWithUpdateAvailable({
            requiresHardReloadRecovery: false,
          });
        }

        let finalResult: AppUpdateCheckResult;
        if (versionResult.kind === 'match') {
          finalResult = 'up_to_date';
        } else if (versionResult.kind === 'timeout') {
          finalResult = 'timeout';
        } else if (versionResult.kind === 'error') {
          finalResult = 'error';
        } else if (swOutcome === 'timeout') {
          finalResult = 'timeout';
        } else if (swOutcome === 'error') {
          finalResult = 'error';
        } else {
          finalResult = 'up_to_date';
        }

        this.setState({
          isChecking: false,
          lastCheckResult: finalResult,
          requiresHardReloadRecovery: false,
        });
        this.config.onCheckComplete?.(finalResult, this.state);
        return finalResult;
      } catch (err) {
        console.warn('[PWA] Manual update check encountered an error:', err);
        this.setState({
          isChecking: false,
          lastCheckResult: 'error',
        });
        this.config.onCheckComplete?.('error', this.state);
        return 'error';
      } finally {
        this.inFlightCheck = null;
      }
    };

    this.inFlightCheck = runCheck();
    return this.inFlightCheck;
  };

  private async purgeRecoverableCaches(): Promise<void> {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        if (typeof navigator.serviceWorker.getRegistrations === 'function') {
          const registrations = await navigator.serviceWorker.getRegistrations();
          await Promise.all(registrations.map((reg) => reg.unregister().catch(() => false)));
        }
      } catch (err) {
        console.warn('[PWA] Failed to unregister service worker during recovery:', err);
      }
    }

    if (typeof window !== 'undefined' && 'caches' in window && window.caches) {
      try {
        const cacheKeys = await window.caches.keys();
        const prefixes = this.config.recoverableCachePrefixes;
        const targets = cacheKeys.filter((key) =>
          prefixes.some((prefix) => key.startsWith(prefix))
        );
        await Promise.all(targets.map((key) => window.caches.delete(key).catch(() => false)));
      } catch (err) {
        console.warn('[PWA] Failed to delete precaches during recovery:', err);
      }
    }
  }

  public applyUpdate = async (): Promise<void> => {
    this.setState({ isUpdating: true });

    let hasReloaded = false;
    const triggerReload = () => {
      if (!hasReloaded) {
        hasReloaded = true;
        this.performReload();
      }
    };

    let reg = this.swRegistration;
    if (
      !reg &&
      typeof navigator !== 'undefined' &&
      'serviceWorker' in navigator &&
      typeof navigator.serviceWorker.getRegistration === 'function'
    ) {
      const regRace = await raceWithTimeout(
        navigator.serviceWorker.getRegistration().catch(() => undefined),
        1500,
        undefined
      );
      reg = regRace.value;
      if (reg) {
        this.swRegistration = reg;
      }
    }

    if (reg?.waiting) {
      if (
        typeof navigator !== 'undefined' &&
        'serviceWorker' in navigator &&
        typeof navigator.serviceWorker.addEventListener === 'function'
      ) {
        navigator.serviceWorker.addEventListener('controllerchange', triggerReload, { once: true });
      }

      try {
        if (typeof reg.waiting.postMessage === 'function') {
          reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        }
        if (this.updateSWFn) {
          await this.updateSWFn(true);
        }
      } catch (err) {
        console.warn('[PWA] Error applying service worker update:', err);
      }

      this.fallbackReloadTimer = setTimeout(triggerReload, this.config.reloadFallbackMs);
      return;
    }

    // iOS standalone self-healing path: version.json proved a newer build exists,
    // but no waiting SW could be staged due to wedged Service Worker lifecycle.
    if (this.state.requiresHardReloadRecovery) {
      await this.purgeRecoverableCaches();
      triggerReload();
      return;
    }

    // Standard fallback (e.g. dev mode or no active waiting worker)
    try {
      if (this.updateSWFn) {
        await this.updateSWFn(true);
      }
    } catch (err) {
      console.warn('[PWA] Error invoking updateSW fallback:', err);
    }

    this.fallbackReloadTimer = setTimeout(triggerReload, this.config.reloadFallbackMs);
  };

  public dismissPrompt = (): void => {
    this.setState({ isPromptDismissed: true });
  };

  public destroy(): void {
    if (this.activeCleanup) {
      this.activeCleanup();
      this.activeCleanup = null;
    }
    if (this.fallbackReloadTimer !== null) {
      clearTimeout(this.fallbackReloadTimer);
      this.fallbackReloadTimer = null;
    }
    this.listeners.clear();
  }
}

export function createPwaUpdateManager(config?: PwaUpdateConfig): PwaUpdateManager {
  return new PwaUpdateManager(config);
}

let defaultManager: PwaUpdateManager | null = null;

export function getDefaultPwaUpdateManager(): PwaUpdateManager {
  if (!defaultManager) {
    defaultManager = new PwaUpdateManager();
  }
  return defaultManager;
}

export function configurePwaUpdate(config: PwaUpdateConfig): PwaUpdateManager {
  defaultManager?.destroy();
  defaultManager = new PwaUpdateManager(config);
  return defaultManager;
}

export function registerPwaServiceWorker(registerSWImpl: RegisterSWFn): () => void {
  return getDefaultPwaUpdateManager().register(registerSWImpl);
}

export function checkForPwaAppUpdate(): Promise<AppUpdateCheckResult> {
  return getDefaultPwaUpdateManager().checkForUpdates();
}

export function applyPwaAppUpdate(): Promise<void> {
  return getDefaultPwaUpdateManager().applyUpdate();
}

export function dismissPwaUpdatePrompt(): void {
  getDefaultPwaUpdateManager().dismissPrompt();
}

export function resetPwaUpdateManager(): void {
  defaultManager?.destroy();
  defaultManager = null;
}
