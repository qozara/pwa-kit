// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createPwaUpdateManager,
  PwaUpdateManager,
  DEFAULT_RECOVERABLE_CACHE_PREFIXES,
  DEFAULT_VISIBILITY_COOLDOWN_MS,
  type RegisterSWFn,
  type RegisterSWOptions,
} from '../src/index.js';

interface MockServiceWorker extends EventTarget {
  state: ServiceWorkerState;
  postMessage: ReturnType<typeof vi.fn>;
}

function createMockWorker(initialState: ServiceWorkerState = 'installing'): MockServiceWorker {
  const target = new EventTarget() as MockServiceWorker;
  target.state = initialState;
  target.postMessage = vi.fn();
  return target;
}

interface MockRegistration extends EventTarget {
  waiting: MockServiceWorker | null;
  installing: MockServiceWorker | null;
  active: MockServiceWorker | null;
  update: ReturnType<typeof vi.fn>;
  unregister: ReturnType<typeof vi.fn>;
}

function createMockRegistration(
  overrides: Partial<Pick<MockRegistration, 'waiting' | 'installing' | 'active'>> = {}
): MockRegistration {
  const target = new EventTarget() as MockRegistration;
  target.waiting = overrides.waiting ?? null;
  target.installing = overrides.installing ?? null;
  target.active = overrides.active ?? null;
  target.update = vi.fn().mockResolvedValue(undefined);
  target.unregister = vi.fn().mockResolvedValue(true);
  return target;
}

function mockServiceWorkerContainer(registration: MockRegistration | undefined) {
  const containerListeners = new EventTarget();
  const container = {
    controller: {} as ServiceWorker,
    getRegistration: vi.fn().mockResolvedValue(registration),
    getRegistrations: vi.fn().mockResolvedValue(registration ? [registration] : []),
    addEventListener: containerListeners.addEventListener.bind(containerListeners),
    removeEventListener: containerListeners.removeEventListener.bind(containerListeners),
    dispatchEvent: containerListeners.dispatchEvent.bind(containerListeners),
  };

  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: container,
  });

  return container;
}

describe('PwaUpdateManager', () => {
  const createdManagers: PwaUpdateManager[] = [];
  const createTrackedManager = (
    ...args: Parameters<typeof createPwaUpdateManager>
  ): PwaUpdateManager => {
    const mgr = createPwaUpdateManager(...args);
    createdManagers.push(mgr);
    return mgr;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
  });

  afterEach(() => {
    while (createdManagers.length > 0) {
      createdManagers.pop()?.destroy();
    }
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers with immediate: true and detects an already-waiting service worker', () => {
    const waitingWorker = createMockWorker('installed');
    const reg = createMockRegistration({ waiting: waitingWorker });
    mockServiceWorkerContainer(reg);

    let capturedOptions: RegisterSWOptions | undefined;
    const registerSWImpl: RegisterSWFn = vi.fn((options) => {
      capturedOptions = options;
      options?.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
      return vi.fn().mockResolvedValue(undefined);
    });

    const onUpdateAvailable = vi.fn();
    const manager = createTrackedManager({
      currentVersion: '263c0d5',
      onUpdateAvailable,
    });

    manager.register(registerSWImpl);

    expect(registerSWImpl).toHaveBeenCalledTimes(1);
    expect(capturedOptions?.immediate).toBe(true);
    expect(manager.getSnapshot().needRefresh).toBe(true);
    expect(manager.getSnapshot().lastCheckResult).toBe('update_available');
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
  });

  it('attaches a persistent native updatefound listener and surfaces installed updates after >60s', () => {
    const activeWorker = createMockWorker('activated');
    const reg = createMockRegistration({ active: activeWorker });
    mockServiceWorkerContainer(reg);

    const registerSWImpl: RegisterSWFn = vi.fn((options) => {
      options?.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
      return vi.fn().mockResolvedValue(undefined);
    });

    const onUpdateAvailable = vi.fn();
    const manager = createTrackedManager({
      currentVersion: '263c0d5',
      onUpdateAvailable,
    });

    manager.register(registerSWImpl);
    expect(manager.getSnapshot().needRefresh).toBe(false);

    // Simulate background update found later during app usage
    const installingWorker = createMockWorker('installing');
    reg.installing = installingWorker;
    reg.dispatchEvent(new Event('updatefound'));

    expect(manager.getSnapshot().needRefresh).toBe(false);

    installingWorker.state = 'installed';
    installingWorker.dispatchEvent(new Event('statechange'));

    expect(manager.getSnapshot().needRefresh).toBe(true);
    expect(manager.getSnapshot().lastCheckResult).toBe('update_available');
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
  });

  it('checks /version.json and reg.update() on visibilitychange after cooldown and throttles within cooldown', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-18T12:00:00Z'));

    const activeWorker = createMockWorker('activated');
    const reg = createMockRegistration({ active: activeWorker });
    mockServiceWorkerContainer(reg);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '263c0d5' }), { status: 200 })
    );

    const manager = createTrackedManager({
      currentVersion: '263c0d5',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    const cleanup = manager.register(
      vi.fn((options) => {
        options?.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
        return vi.fn().mockResolvedValue(undefined);
      })
    );

    // Within cooldown -> skipped
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reg.update).not.toHaveBeenCalled();

    // Hidden state -> skipped even after cooldown
    vi.advanceTimersByTime(DEFAULT_VISIBILITY_COOLDOWN_MS + 1000);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).not.toHaveBeenCalled();

    // Visible state after cooldown -> triggers check
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(reg.update).toHaveBeenCalledTimes(1);
    });

    // Immediate resume within cooldown -> throttled
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it('detects update via /version.json even when iOS reg.update() hangs indefinitely', async () => {
    vi.useFakeTimers();

    const activeWorker = createMockWorker('activated');
    const reg = createMockRegistration({ active: activeWorker });
    // Hang reg.update() forever like iOS standalone PWA WebKit bug
    reg.update = vi.fn().mockImplementation(() => new Promise(() => {}));
    mockServiceWorkerContainer(reg);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '156003f', builtAt: '2026-11-18T02:15:00Z' }), {
        status: 200,
      })
    );

    const onUpdateAvailable = vi.fn();
    const manager = createTrackedManager({
      currentVersion: '263c0d5',
      swGracePeriodMs: 1000,
      fetchImpl: fetchMock as unknown as typeof fetch,
      onUpdateAvailable,
    });

    manager.register(
      vi.fn((options) => {
        options?.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
        return vi.fn().mockResolvedValue(undefined);
      })
    );

    const checkPromise = manager.checkForUpdates();

    await vi.advanceTimersByTimeAsync(1000);
    const result = await checkPromise;

    expect(result).toBe('update_available');
    const snap = manager.getSnapshot();
    expect(snap.needRefresh).toBe(true);
    expect(snap.availableVersion).toBe('156003f');
    expect(snap.requiresHardReloadRecovery).toBe(true);
    expect(snap.lastCheckResult).toBe('update_available');
    expect(snap.isChecking).toBe(false);
    expect(onUpdateAvailable).toHaveBeenCalledTimes(1);
  });

  it('never reports up_to_date when /version.json times out or errors', async () => {
    vi.useFakeTimers();

    const activeWorker = createMockWorker('activated');
    const reg = createMockRegistration({ active: activeWorker });
    reg.update = vi.fn().mockImplementation(() => new Promise(() => {}));
    mockServiceWorkerContainer(reg);

    // 1. Timeout scenario (fetch honors AbortSignal)
    const hangingFetch = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
    });

    const timeoutManager = createTrackedManager({
      currentVersion: '263c0d5',
      networkTimeoutMs: 500,
      swTimeoutMs: 600,
      fetchImpl: hangingFetch as unknown as typeof fetch,
    });

    timeoutManager.register(
      vi.fn((options) => {
        options?.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
        return vi.fn().mockResolvedValue(undefined);
      })
    );

    const timeoutCheck = timeoutManager.checkForUpdates();
    await vi.advanceTimersByTimeAsync(700);
    const timeoutResult = await timeoutCheck;

    expect(timeoutResult).toBe('timeout');
    expect(timeoutManager.getSnapshot().lastCheckResult).toBe('timeout');
    expect(timeoutManager.getSnapshot().needRefresh).toBe(false);

    // 2. HTTP 500 / malformed JSON scenario
    const errorFetch = vi.fn().mockResolvedValue(new Response('Server Error', { status: 500 }));
    const fastReg = createMockRegistration({ active: activeWorker });
    mockServiceWorkerContainer(fastReg);

    const errorManager = createTrackedManager({
      currentVersion: '263c0d5',
      fetchImpl: errorFetch as unknown as typeof fetch,
    });

    errorManager.register(
      vi.fn((options) => {
        options?.onRegisteredSW?.('/sw.js', fastReg as unknown as ServiceWorkerRegistration);
        return vi.fn().mockResolvedValue(undefined);
      })
    );

    const errorResult = await errorManager.checkForUpdates();
    expect(errorResult).toBe('error');
    expect(errorManager.getSnapshot().lastCheckResult).toBe('error');
    expect(errorManager.getSnapshot().needRefresh).toBe(false);
  });

  it('confirms up_to_date when server version matches currentVersion and no waiting SW exists', async () => {
    const activeWorker = createMockWorker('activated');
    const reg = createMockRegistration({ active: activeWorker });
    mockServiceWorkerContainer(reg);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '156003f' }), { status: 200 })
    );

    const manager = createTrackedManager({
      currentVersion: '156003f',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    manager.register(
      vi.fn((options) => {
        options?.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
        return vi.fn().mockResolvedValue(undefined);
      })
    );

    const result = await manager.checkForUpdates();
    expect(result).toBe('up_to_date');
    expect(manager.getSnapshot().lastCheckResult).toBe('up_to_date');
    expect(manager.getSnapshot().needRefresh).toBe(false);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/version\.json\?_t=\d+$/),
      expect.objectContaining({ cache: 'no-store' })
    );
  });

  it('returns offline immediately without calling fetch or reg.update() when offline', async () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false,
    });

    const reg = createMockRegistration();
    mockServiceWorkerContainer(reg);
    const fetchMock = vi.fn();

    const manager = createTrackedManager({
      currentVersion: '263c0d5',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    manager.register(
      vi.fn((options) => {
        options?.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
        return vi.fn().mockResolvedValue(undefined);
      })
    );

    const result = await manager.checkForUpdates();
    expect(result).toBe('offline');
    expect(manager.getSnapshot().lastCheckResult).toBe('offline');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(reg.update).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent checkForUpdates calls and preserves update if onNeedRefresh fires mid-check', async () => {
    const reg = createMockRegistration();
    mockServiceWorkerContainer(reg);

    let capturedOptions: RegisterSWOptions | undefined;
    let resolveFetch!: (res: Response) => void;
    const fetchMock = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const manager = createTrackedManager({
      currentVersion: '263c0d5',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    manager.register(
      vi.fn((options) => {
        capturedOptions = options;
        options?.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
        return vi.fn().mockResolvedValue(undefined);
      })
    );

    const p1 = manager.checkForUpdates();
    const p2 = manager.checkForUpdates();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Mid-check Workbox fires onNeedRefresh
    capturedOptions?.onNeedRefresh?.();
    resolveFetch(new Response(JSON.stringify({ version: '263c0d5' }), { status: 200 }));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toBe('update_available');
    expect(r2).toBe('update_available');
    expect(manager.getSnapshot().needRefresh).toBe(true);
    expect(manager.getSnapshot().lastCheckResult).toBe('update_available');
  });

  it('applies normal update by messaging SKIP_WAITING and reloading on controllerchange', async () => {
    const waitingWorker = createMockWorker('installed');
    const reg = createMockRegistration({ waiting: waitingWorker });
    const container = mockServiceWorkerContainer(reg);

    const onReload = vi.fn();
    const mockUpdateSW = vi.fn().mockResolvedValue(undefined);

    const manager = createTrackedManager({
      currentVersion: '263c0d5',
      onReload,
    });

    manager.register(
      vi.fn((options) => {
        options?.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
        return mockUpdateSW;
      })
    );

    await manager.applyUpdate();

    expect(manager.getSnapshot().isUpdating).toBe(true);
    expect(waitingWorker.postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
    expect(mockUpdateSW).toHaveBeenCalledWith(true);

    container.dispatchEvent(new Event('controllerchange'));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('performs self-healing iOS recovery when no waiting SW exists, preserving user caches and storage', async () => {
    vi.useFakeTimers();

    const activeWorker = createMockWorker('activated');
    const reg = createMockRegistration({ active: activeWorker });
    reg.update = vi.fn().mockImplementation(() => new Promise(() => {}));
    const container = mockServiceWorkerContainer(reg);

    const deletedCaches: string[] = [];
    const cachesMock = {
      keys: vi
        .fn()
        .mockResolvedValue([
          'workbox-precache-v2-https://app.quozen.qozara.org/',
          'navigation-cache',
          'static-assets-cache',
          'google-fonts-cache',
          'custom-user-cache',
        ]),
      delete: vi.fn(async (key: string) => {
        deletedCaches.push(key);
        return true;
      }),
    };
    Object.defineProperty(window, 'caches', {
      configurable: true,
      value: cachesMock,
    });

    localStorage.setItem('quozen_keep_me', 'yes');
    sessionStorage.setItem('quozen_session_keep', 'yes');

    const onReload = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '156003f' }), { status: 200 })
    );

    const manager = createTrackedManager({
      currentVersion: '263c0d5',
      swGracePeriodMs: 200,
      recoverableCachePrefixes: DEFAULT_RECOVERABLE_CACHE_PREFIXES,
      fetchImpl: fetchMock as unknown as typeof fetch,
      onReload,
    });

    manager.register(
      vi.fn((options) => {
        options?.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
        return vi.fn().mockResolvedValue(undefined);
      })
    );

    const checkPromise = manager.checkForUpdates();
    await vi.advanceTimersByTimeAsync(200);
    await checkPromise;

    await manager.applyUpdate();

    expect(container.getRegistrations).toHaveBeenCalledTimes(1);
    expect(reg.unregister).toHaveBeenCalledTimes(1);
    expect(deletedCaches).toEqual([
      'workbox-precache-v2-https://app.quozen.qozara.org/',
      'navigation-cache',
      'static-assets-cache',
    ]);
    expect(deletedCaches).not.toContain('google-fonts-cache');
    expect(deletedCaches).not.toContain('custom-user-cache');
    expect(localStorage.getItem('quozen_keep_me')).toBe('yes');
    expect(sessionStorage.getItem('quozen_session_keep')).toBe('yes');
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('supports dismissPrompt and re-surfaces prompt when checkForUpdates runs again', async () => {
    const waitingWorker = createMockWorker('installed');
    const reg = createMockRegistration({ waiting: waitingWorker });
    mockServiceWorkerContainer(reg);

    const manager = createTrackedManager();
    manager.register(
      vi.fn((options) => {
        options?.onRegisteredSW?.('/sw.js', reg as unknown as ServiceWorkerRegistration);
        return vi.fn().mockResolvedValue(undefined);
      })
    );

    expect(manager.getSnapshot().needRefresh).toBe(true);
    expect(manager.getSnapshot().isPromptDismissed).toBe(false);

    manager.dismissPrompt();
    expect(manager.getSnapshot().needRefresh).toBe(true);
    expect(manager.getSnapshot().isPromptDismissed).toBe(true);

    const res = await manager.checkForUpdates();
    expect(res).toBe('update_available');
    expect(manager.getSnapshot().isPromptDismissed).toBe(false);
  });

  it('reloads automatically when vite:preloadError fires', () => {
    const onReload = vi.fn();
    const manager = createTrackedManager({ onReload });
    const cleanup = manager.register(vi.fn(() => vi.fn().mockResolvedValue(undefined)));

    window.dispatchEvent(new Event('vite:preloadError'));
    expect(onReload).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
