import { describe, it, expect, vi } from 'vitest';
import {
  qozaraPwaVersionPlugin,
  PWA_VERSION_FILENAME,
  PWA_VERSION_GLOB_IGNORES,
  PWA_VERCEL_NO_CACHE_HEADERS,
} from '../src/plugin.js';

function createMockMiddlewareHarness() {
  const middlewares: Array<(req: { url?: string }, res: MockRes, next: () => void) => void> = [];
  const server = {
    middlewares: {
      use(fn: (req: { url?: string }, res: MockRes, next: () => void) => void) {
        middlewares.push(fn);
      },
    },
  };
  return { middlewares, server };
}

interface MockRes {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
  setHeader: (key: string, value: string) => void;
  end: (chunk?: string) => void;
}

function createMockRes(): MockRes {
  const res: MockRes = {
    statusCode: 0,
    headers: {},
    body: '',
    setHeader(key: string, value: string) {
      res.headers[key] = value;
    },
    end(chunk = '') {
      res.body = chunk;
    },
  };
  return res;
}

describe('qozaraPwaVersionPlugin', () => {
  it('injects default __APP_VERSION__ and custom defineKey into Vite define config', () => {
    const defaultPlugin = qozaraPwaVersionPlugin({
      env: { VERCEL_GIT_COMMIT_SHA: '156003f99fc15cf2' },
    });
    const configResult = (defaultPlugin.config as () => { define: Record<string, string> })();
    expect(configResult.define).toEqual({
      __APP_VERSION__: '"156003f"',
    });

    const customPlugin = qozaraPwaVersionPlugin({
      defineKey: '__COMMIT_HASH__',
      env: { VERCEL_GIT_COMMIT_SHA: '156003f99fc15cf2' },
    });
    const customConfig = (customPlugin.config as () => { define: Record<string, string> })();
    expect(customConfig.define).toEqual({
      __COMMIT_HASH__: '"156003f"',
    });
  });

  it('emits version.json asset in generateBundle matching the defined version', () => {
    const plugin = qozaraPwaVersionPlugin({
      env: { VERCEL_GIT_COMMIT_SHA: '156003f99fc15cf2' },
      builtAt: '2026-11-18T19:30:00.000Z',
    });

    const emitFile = vi.fn();
    const generateBundle = plugin.generateBundle as unknown as (
      this: { emitFile: typeof emitFile }
    ) => void;
    generateBundle.call({ emitFile });

    expect(emitFile).toHaveBeenCalledTimes(1);
    const emitted = emitFile.mock.calls[0][0];
    expect(emitted.type).toBe('asset');
    expect(emitted.fileName).toBe('version.json');
    expect(JSON.parse(emitted.source)).toEqual({
      version: '156003f',
      builtAt: '2026-11-18T19:30:00.000Z',
    });
  });

  it('serves /version.json (including cache-busting query params) with no-store headers in dev server', () => {
    const plugin = qozaraPwaVersionPlugin({
      env: { GITHUB_SHA: 'abcdef123456' },
      builtAt: '2026-11-18T19:30:00.000Z',
    });

    const { middlewares, server } = createMockMiddlewareHarness();
    const configureServer = plugin.configureServer as unknown as (srv: typeof server) => void;
    configureServer(server);
    expect(middlewares).toHaveLength(1);

    const mw = middlewares[0];

    // Exact match and cache-busting query string
    for (const url of ['/version.json', '/version.json?_t=1795035000000']) {
      const res = createMockRes();
      const next = vi.fn();
      mw({ url }, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(200);
      expect(res.headers['Content-Type']).toBe('application/json; charset=utf-8');
      expect(res.headers['Cache-Control']).toBe('no-cache, no-store, must-revalidate');
      expect(JSON.parse(res.body)).toEqual({
        version: 'abcdef1',
        builtAt: '2026-11-18T19:30:00.000Z',
      });
    }

    // Unrelated requests pass through via next()
    const unrelatedRes = createMockRes();
    const next = vi.fn();
    mw({ url: '/assets/index.js' }, unrelatedRes, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(unrelatedRes.body).toBe('');
  });

  it('serves /version.json identically in preview server', () => {
    const plugin = qozaraPwaVersionPlugin({
      version: '156003f',
      builtAt: '2026-11-18T19:30:00.000Z',
    });

    const { middlewares, server } = createMockMiddlewareHarness();
    const configurePreviewServer = plugin.configurePreviewServer as unknown as (
      srv: typeof server
    ) => void;
    configurePreviewServer(server);
    expect(middlewares).toHaveLength(1);

    const res = createMockRes();
    const next = vi.fn();
    middlewares[0]({ url: '/version.json?_t=999' }, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(200);
    expect(res.headers['Cache-Control']).toBe('no-cache, no-store, must-revalidate');
    expect(JSON.parse(res.body)).toEqual({
      version: '156003f',
      builtAt: '2026-11-18T19:30:00.000Z',
    });
  });

  it('exports Workbox globIgnores and Vercel no-cache header helpers', () => {
    expect(PWA_VERSION_FILENAME).toBe('version.json');
    expect(PWA_VERSION_GLOB_IGNORES).toEqual(['**/version.json']);
    expect(PWA_VERCEL_NO_CACHE_HEADERS.map((h) => h.source)).toEqual([
      '/sw.js',
      '/version.json',
      '/index.html',
    ]);
    for (const rule of PWA_VERCEL_NO_CACHE_HEADERS) {
      expect(rule.headers).toContainEqual({
        key: 'Cache-Control',
        value: 'no-cache, no-store, must-revalidate',
      });
    }
  });
});
