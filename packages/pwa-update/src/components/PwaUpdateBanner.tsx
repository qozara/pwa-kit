import type React from 'react';
import type { PwaUpdateManager } from '../manager.js';
import { usePwaUpdate } from '../react.js';

export interface PwaUpdateBannerLabels {
  title?: string;
  description?: string;
  availableVersionPrefix?: string;
  reload?: string;
  updating?: string;
  dismiss?: string;
}

export interface PwaUpdateBannerClassNames {
  root?: string;
  content?: string;
  iconWrapper?: string;
  textWrapper?: string;
  title?: string;
  description?: string;
  versionBadge?: string;
  actions?: string;
  reloadButton?: string;
  dismissButton?: string;
}

export type BannerIconSlot = React.ReactNode | ((state: { isUpdating: boolean }) => React.ReactNode);

export interface PwaUpdateBannerProps {
  manager?: PwaUpdateManager;
  labels?: PwaUpdateBannerLabels;
  classNames?: PwaUpdateBannerClassNames;
  icon?: BannerIconSlot;
  reloadIcon?: BannerIconSlot;
  dismissIcon?: React.ReactNode;
  showAvailableVersion?: boolean;
  hideDismiss?: boolean;
  ids?: {
    root?: string;
    reloadButton?: string;
    dismissButton?: string;
  };
  testIds?: {
    root?: string;
    reloadButton?: string;
    dismissButton?: string;
  };
}

export function PwaUpdateBanner({
  manager,
  labels,
  classNames,
  icon,
  reloadIcon,
  dismissIcon,
  showAvailableVersion = false,
  hideDismiss = false,
  ids,
  testIds,
}: PwaUpdateBannerProps) {
  const {
    needRefresh,
    isUpdating,
    isPromptDismissed,
    availableVersion,
    applyUpdate,
    dismissPrompt,
  } = usePwaUpdate(manager);

  if (!needRefresh || isPromptDismissed) {
    return null;
  }

  const resolvedIcon = typeof icon === 'function' ? icon({ isUpdating }) : icon;
  const resolvedReloadIcon =
    typeof reloadIcon === 'function' ? reloadIcon({ isUpdating }) : reloadIcon;

  const title = labels?.title ?? 'Update Available';
  const description = labels?.description ?? 'A new version is ready to install.';
  const versionPrefix = labels?.availableVersionPrefix ?? 'v';
  const reloadLabel = isUpdating
    ? (labels?.updating ?? labels?.reload ?? 'Updating...')
    : (labels?.reload ?? 'Update & Reload');
  const dismissLabel = labels?.dismiss ?? 'Dismiss';

  return (
    <div
      id={ids?.root}
      data-testid={testIds?.root ?? 'pwa-update-banner'}
      role="status"
      aria-live="polite"
      className={classNames?.root}
    >
      <div className={classNames?.content}>
        {resolvedIcon ? <div className={classNames?.iconWrapper}>{resolvedIcon}</div> : null}
        <div className={classNames?.textWrapper}>
          <h4 className={classNames?.title}>{title}</h4>
          <p className={classNames?.description}>
            {description}
            {showAvailableVersion && availableVersion ? (
              <span className={classNames?.versionBadge}>
                {' '}
                ({versionPrefix}
                {availableVersion})
              </span>
            ) : null}
          </p>
        </div>
      </div>

      <div className={classNames?.actions}>
        <button
          type="button"
          id={ids?.reloadButton}
          data-testid={testIds?.reloadButton ?? 'pwa-update-reload'}
          disabled={isUpdating}
          onClick={() => void applyUpdate()}
          className={classNames?.reloadButton}
        >
          {resolvedReloadIcon}
          <span>{reloadLabel}</span>
        </button>

        {!hideDismiss ? (
          <button
            type="button"
            id={ids?.dismissButton}
            data-testid={testIds?.dismissButton ?? 'pwa-update-dismiss'}
            disabled={isUpdating}
            onClick={() => dismissPrompt()}
            aria-label={dismissLabel}
            className={classNames?.dismissButton}
          >
            {dismissIcon ?? dismissLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
