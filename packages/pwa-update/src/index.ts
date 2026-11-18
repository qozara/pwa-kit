export {
  PwaUpdateManager,
  createPwaUpdateManager,
  configurePwaUpdate,
  getDefaultPwaUpdateManager,
  registerPwaServiceWorker,
  checkForPwaAppUpdate,
  applyPwaAppUpdate,
  dismissPwaUpdatePrompt,
  resetPwaUpdateManager,
  DEFAULT_VISIBILITY_COOLDOWN_MS,
  DEFAULT_RECOVERABLE_CACHE_PREFIXES,
} from './manager.js';

export { PwaUpdateProvider, usePwaUpdate } from './react.js';
export type { PwaUpdateProviderProps } from './react.js';

export { PwaUpdateBanner } from './components/PwaUpdateBanner.js';
export type {
  BannerIconSlot,
  PwaUpdateBannerProps,
  PwaUpdateBannerLabels,
  PwaUpdateBannerClassNames,
} from './components/PwaUpdateBanner.js';

export { VersionCheckControl } from './components/VersionCheckControl.js';
export type {
  CheckIconSlot,
  UpdateIconSlot,
  StatusIconSlot,
  VersionCheckControlProps,
  VersionCheckControlLabels,
  VersionCheckControlClassNames,
} from './components/VersionCheckControl.js';

export type {
  AppUpdateCheckResult,
  RegisterSWOptions,
  RegisterSWFn,
  PwaUpdateState,
  PwaUpdateConfig,
  PwaUpdateContextValue,
} from './types.js';
