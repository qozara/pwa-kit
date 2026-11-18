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

export interface PwaUpdateBannerProps {
  manager?: PwaUpdateManager;
  labels?: PwaUpdateBannerLabels;
  classNames?: PwaUpdateBannerClassNames;
  icon?: React.ReactNode;
  reloadIcon?: React.ReactNode;
  dismissIcon?: React.ReactNode;
  showAvailableVersion?: boolean;
  hideDismiss?: boolean;
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

  const title = labels?.title ?? 'Update Available';
  const description = labels?.description ?? 'A new version is ready to install.';
  const versionPrefix = labels?.availableVersionPrefix ?? 'v';
  const reloadLabel = isUpdating
    ? (labels?.updating ?? labels?.reload ?? 'Updating...')
    : (labels?.reload ?? 'Update & Reload');
  const dismissLabel = labels?.dismiss ?? 'Dismiss';

  return (
    <div
      data-testid={testIds?.root ?? 'pwa-update-banner'}
      role="status"
      aria-live="polite"
      className={classNames?.root}
    >
      <div className={classNames?.content}>
        {icon ? <div className={classNames?.iconWrapper}>{icon}</div> : null}
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
          data-testid={testIds?.reloadButton ?? 'pwa-update-reload'}
          disabled={isUpdating}
          onClick={() => void applyUpdate()}
          className={classNames?.reloadButton}
        >
          {reloadIcon}
          <span>{reloadLabel}</span>
        </button>

        {!hideDismiss ? (
          <button
            type="button"
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
