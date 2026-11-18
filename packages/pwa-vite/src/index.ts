export { resolveGitVersion } from './git-version.js';
export type { ResolveGitVersionOptions } from './git-version.js';

export {
  qozaraPwaVersionPlugin,
  PWA_VERSION_FILENAME,
  PWA_VERSION_GLOB_IGNORES,
  PWA_VERCEL_NO_CACHE_HEADERS,
} from './plugin.js';
export type {
  QozaraPwaVersionPayload,
  QozaraPwaVersionPluginOptions,
  VercelHeaderRule,
} from './plugin.js';
