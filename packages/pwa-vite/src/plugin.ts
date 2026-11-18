import type { Plugin } from 'vite';
import { resolveGitVersion, type ResolveGitVersionOptions } from './git-version.js';

export const PWA_VERSION_FILENAME = 'version.json';

export const PWA_VERSION_GLOB_IGNORES: string[] = ['**/version.json'];

export interface VercelHeaderRule {
  source: string;
  headers: Array<{ key: string; value: string }>;
}

/**
 * Recommended Vercel HTTP header rules ensuring Workbox's Service Worker script,
 * the out-of-band version manifest, and the HTML shell are always revalidated.
 */
export const PWA_VERCEL_NO_CACHE_HEADERS: VercelHeaderRule[] = [
  {
    source: '/sw.js',
    headers: [
      {
        key: 'Cache-Control',
        value: 'no-cache, no-store, must-revalidate',
      },
    ],
  },
  {
    source: '/version.json',
    headers: [
      {
        key: 'Cache-Control',
        value: 'no-cache, no-store, must-revalidate',
      },
    ],
  },
  {
    source: '/index.html',
    headers: [
      {
        key: 'Cache-Control',
        value: 'no-cache, no-store, must-revalidate',
      },
    ],
  },
];

export interface QozaraPwaVersionPayload {
  version: string;
  builtAt: string;
}

export interface QozaraPwaVersionPluginOptions extends ResolveGitVersionOptions {
  /** Global constant identifier injected via Vite `define`. Defaults to `'__APP_VERSION__'`. */
  defineKey?: string;
  /** Asset filename emitted into the build output and served at `/<name>`. Defaults to `'version.json'`. */
  versionFileName?: string;
  /** Explicit version override (useful in tests or custom release pipelines). */
  version?: string;
  /** Explicit ISO build timestamp override (useful in deterministic tests). */
  builtAt?: string;
}

interface ConnectRequest {
  url?: string;
}

interface ConnectResponse {
  statusCode: number;
  setHeader: (name: string, value: string) => void;
  end: (chunk?: string) => void;
}

interface MiddlewareContainer {
  middlewares: {
    use: (
      handler: (req: ConnectRequest, res: ConnectResponse, next: () => void) => void
    ) => unknown;
  };
}

function attachVersionMiddleware(
  server: MiddlewareContainer,
  targetPath: string,
  payloadJson: string
): void {
  server.middlewares.use((req, res, next) => {
    const reqPath = (req.url ?? '').split('?')[0];
    if (reqPath === targetPath) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.end(payloadJson);
      return;
    }
    next();
  });
}

/**
 * Vite plugin that injects a deterministic commit hash constant at build time,
 * emits a tiny uncached `version.json` manifest into `dist/`, and serves it in dev/preview.
 */
export function qozaraPwaVersionPlugin(
  options: QozaraPwaVersionPluginOptions = {}
): Plugin {
  const {
    defineKey = '__APP_VERSION__',
    versionFileName = PWA_VERSION_FILENAME,
    version,
    builtAt,
    ...gitOptions
  } = options;

  const cleanFileName = versionFileName.replace(/^\/+/, '');
  const targetPath = `/${cleanFileName}`;
  const resolvedVersion = version ?? resolveGitVersion(gitOptions);
  const payload: QozaraPwaVersionPayload = {
    version: resolvedVersion,
    builtAt: builtAt ?? new Date().toISOString(),
  };
  const payloadJson = JSON.stringify(payload, null, 2);

  return {
    name: 'qozara-pwa-version',
    config() {
      return {
        define: {
          [defineKey]: JSON.stringify(resolvedVersion),
        },
      };
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: cleanFileName,
        source: payloadJson,
      });
    },
    configureServer(server) {
      attachVersionMiddleware(server, targetPath, payloadJson);
    },
    configurePreviewServer(server) {
      attachVersionMiddleware(server, targetPath, payloadJson);
    },
  };
}
