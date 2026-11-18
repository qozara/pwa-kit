import type React from 'react';
import type { PwaUpdateManager } from '../manager.js';
import { usePwaUpdate } from '../react.js';
import type { AppUpdateCheckResult } from '../types.js';

export interface VersionCheckControlLabels {
  versionLabel?: string;
  checkForUpdates?: string;
  checking?: string;
  updateNow?: string;
  updating?: string;
  upToDate?: string;
  updateAvailable?: string;
  offline?: string;
  error?: string;
  timeout?: string;
}

export interface VersionCheckControlClassNames {
  root?: string;
  versionRow?: string;
  versionText?: string;
  statusText?: string;
  checkButton?: string;
  updateButton?: string;
}

export type CheckIconSlot = React.ReactNode | ((state: { isChecking: boolean }) => React.ReactNode);
export type UpdateIconSlot = React.ReactNode | ((state: { isUpdating: boolean }) => React.ReactNode);
export type StatusIconSlot =
  | React.ReactNode
  | ((result: AppUpdateCheckResult | null, needRefresh: boolean) => React.ReactNode);

export interface VersionCheckControlProps {
  manager?: PwaUpdateManager;
  version?: string;
  labels?: VersionCheckControlLabels;
  classNames?: VersionCheckControlClassNames;
  checkIcon?: CheckIconSlot;
  updateIcon?: UpdateIconSlot;
  statusIcon?: StatusIconSlot;
  disabled?: boolean;
  showStatus?: boolean;
  onCheckComplete?: (result: AppUpdateCheckResult) => void;
  ids?: {
    root?: string;
    checkButton?: string;
    updateButton?: string;
  };
  testIds?: {
    root?: string;
    versionText?: string;
    statusText?: string;
    checkButton?: string;
    updateButton?: string;
  };
}

function formatTemplate(template: string, values: Record<string, string>): string {
  return Object.entries(values).reduce(
    (acc, [key, value]) => acc.replaceAll(`{{${key}}}`, value),
    template
  );
}

export function VersionCheckControl({
  manager,
  version,
  labels,
  classNames,
  checkIcon,
  updateIcon,
  statusIcon,
  disabled = false,
  showStatus = true,
  onCheckComplete,
  ids,
  testIds,
}: VersionCheckControlProps) {
  const {
    needRefresh,
    isChecking,
    isUpdating,
    lastCheckResult,
    currentVersion,
    availableVersion,
    checkForUpdates,
    applyUpdate,
  } = usePwaUpdate(manager);

  const resolvedVersion = version ?? currentVersion ?? 'dev';
  const versionText = formatTemplate(labels?.versionLabel ?? 'Version {{version}}', {
    version: resolvedVersion,
  });

  const handleCheck = async () => {
    const result = await checkForUpdates();
    onCheckComplete?.(result);
  };

  let statusMessage: string | null = null;
  if (showStatus) {
    if (needRefresh) {
      const template = labels?.updateAvailable ?? 'New version available!';
      statusMessage = availableVersion
        ? formatTemplate(template, { version: availableVersion })
        : template;
    } else if (lastCheckResult === 'up_to_date') {
      statusMessage = labels?.upToDate ?? 'Up to date';
    } else if (lastCheckResult === 'offline') {
      statusMessage = labels?.offline ?? 'Connect to the internet to check for updates.';
    } else if (lastCheckResult === 'timeout') {
      statusMessage = labels?.timeout ?? 'Update check timed out. Please try again.';
    } else if (lastCheckResult === 'error') {
      statusMessage = labels?.error ?? 'Could not check for app updates.';
    }
  }

  const resolvedCheckIcon = typeof checkIcon === 'function' ? checkIcon({ isChecking }) : checkIcon;
  const resolvedUpdateIcon =
    typeof updateIcon === 'function' ? updateIcon({ isUpdating }) : updateIcon;
  const resolvedStatusIcon =
    typeof statusIcon === 'function' ? statusIcon(lastCheckResult, needRefresh) : statusIcon;

  return (
    <div
      id={ids?.root}
      data-testid={testIds?.root ?? 'pwa-version-control'}
      className={classNames?.root}
    >
      <div className={classNames?.versionRow}>
        <span data-testid={testIds?.versionText ?? 'pwa-version-text'} className={classNames?.versionText}>
          {versionText}
        </span>

        {statusMessage ? (
          <span
            data-testid={testIds?.statusText ?? 'pwa-status-text'}
            role="status"
            aria-live="polite"
            className={classNames?.statusText}
          >
            {resolvedStatusIcon}
            {statusMessage}
          </span>
        ) : null}
      </div>

      {needRefresh ? (
        <button
          type="button"
          id={ids?.updateButton}
          data-testid={testIds?.updateButton ?? 'pwa-update-button'}
          disabled={isUpdating}
          onClick={() => void applyUpdate()}
          className={classNames?.updateButton}
        >
          {resolvedUpdateIcon}
          <span>
            {isUpdating
              ? (labels?.updating ?? labels?.updateNow ?? 'Updating...')
              : (labels?.updateNow ?? 'Update & Reload')}
          </span>
        </button>
      ) : (
        <button
          type="button"
          id={ids?.checkButton}
          data-testid={testIds?.checkButton ?? 'pwa-check-button'}
          disabled={disabled || isChecking}
          onClick={() => void handleCheck()}
          className={classNames?.checkButton}
        >
          {resolvedCheckIcon}
          <span>
            {isChecking
              ? (labels?.checking ?? 'Checking...')
              : (labels?.checkForUpdates ?? 'Check for updates')}
          </span>
        </button>
      )}
    </div>
  );
}
