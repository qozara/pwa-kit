// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import {
  PwaUpdateBanner,
  VersionCheckControl,
  PwaUpdateProvider,
  createPwaUpdateManager,
  type PwaUpdateManager,
} from '../src/index.js';

describe('Optional PWA UI Components', () => {
  const managers: PwaUpdateManager[] = [];
  const createTracked = (
    ...args: Parameters<typeof createPwaUpdateManager>
  ): PwaUpdateManager => {
    const m = createPwaUpdateManager(...args);
    managers.push(m);
    return m;
  };

  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    while (managers.length > 0) {
      managers.pop()?.destroy();
    }
    cleanup();
    vi.restoreAllMocks();
  });

  describe('PwaUpdateBanner', () => {
    it('renders null until needRefresh is true and hides when dismissed', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ version: '156003f' }), { status: 200 })
      );
      const onReload = vi.fn();
      const manager = createTracked({
        currentVersion: '263c0d5',
        swGracePeriodMs: 10,
        fetchImpl: fetchMock as unknown as typeof fetch,
        onReload,
      });

      render(
        <PwaUpdateProvider manager={manager}>
          <PwaUpdateBanner
            showAvailableVersion
            labels={{
              title: 'New Build Ready',
              description: 'Tap below to update.',
              reload: 'Reload App',
              dismiss: 'Later',
            }}
            classNames={{
              root: 'custom-banner-root',
              reloadButton: 'custom-reload-btn',
            }}
          />
        </PwaUpdateProvider>
      );

      expect(screen.queryByTestId('pwa-update-banner')).toBeNull();

      await act(async () => {
        await manager.checkForUpdates();
      });

      const banner = screen.getByTestId('pwa-update-banner');
      expect(banner.getAttribute('role')).toBe('status');
      expect(banner.getAttribute('aria-live')).toBe('polite');
      expect(banner.className).toContain('custom-banner-root');
      expect(screen.getByText('New Build Ready')).toBeTruthy();
      expect(screen.getByText(/156003f/)).toBeTruthy();

      const reloadBtn = screen.getByTestId('pwa-update-reload');
      expect(reloadBtn.className).toContain('custom-reload-btn');

      // Dismiss hides banner
      fireEvent.click(screen.getByTestId('pwa-update-dismiss'));
      expect(screen.queryByTestId('pwa-update-banner')).toBeNull();
    });

    it('invokes applyUpdate when reload button is clicked', async () => {
      const onReload = vi.fn();
      const manager = createTracked({
        currentVersion: '263c0d5',
        reloadFallbackMs: 20,
        onReload,
      });
      let onNeedRefreshCb: (() => void) | undefined;
      manager.register(
        vi.fn((opts) => {
          onNeedRefreshCb = opts?.onNeedRefresh;
          return vi.fn().mockResolvedValue(undefined);
        })
      );

      render(<PwaUpdateBanner manager={manager} />);
      act(() => {
        onNeedRefreshCb?.();
      });

      const reloadBtn = screen.getByTestId('pwa-update-reload');
      await act(async () => {
        fireEvent.click(reloadBtn);
      });

      expect((reloadBtn as HTMLButtonElement).disabled).toBe(true);
    });
  });

  describe('VersionCheckControl', () => {
    it('displays formatted version, checks for updates, shows status, and transitions to update button', async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ version: '263c0d5' }), { status: 200 })
        )
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ version: '156003f' }), { status: 200 })
        );

      const manager = createTracked({
        currentVersion: '263c0d5',
        swGracePeriodMs: 10,
        fetchImpl: fetchMock as unknown as typeof fetch,
        onReload: vi.fn(),
      });

      const onCheckComplete = vi.fn();

      render(
        <VersionCheckControl
          manager={manager}
          labels={{
            versionLabel: 'Version {{version}}',
            checkForUpdates: 'Check App Update',
            checking: 'Checking...',
            upToDate: 'Running latest build',
            updateAvailable: 'Version {{version}} available!',
            updateNow: 'Update & Reload',
          }}
          onCheckComplete={onCheckComplete}
        />
      );

      expect(screen.getByTestId('pwa-version-text').textContent).toBe('Version 263c0d5');

      // First check -> up_to_date
      await act(async () => {
        fireEvent.click(screen.getByTestId('pwa-check-button'));
      });
      expect(onCheckComplete).toHaveBeenCalledWith('up_to_date');
      expect(screen.getByTestId('pwa-status-text').textContent).toBe('Running latest build');

      // Second check -> update_available -> transitions button to Update & Reload
      await act(async () => {
        fireEvent.click(screen.getByTestId('pwa-check-button'));
      });
      expect(onCheckComplete).toHaveBeenCalledWith('update_available');
      expect(screen.getByTestId('pwa-status-text').textContent).toBe(
        'Version 156003f available!'
      );
      expect(screen.getByTestId('pwa-update-button').textContent).toContain('Update & Reload');
    });

    it('renders explicit error/timeout/offline feedback and respects disabled prop', async () => {
      const errorFetch = vi.fn().mockRejectedValue(new Error('Network down'));
      const manager = createTracked({
        currentVersion: '263c0d5',
        fetchImpl: errorFetch as unknown as typeof fetch,
      });

      const { rerender } = render(
        <VersionCheckControl
          manager={manager}
          labels={{
            error: 'Check failed',
            offline: 'You are offline',
          }}
        />
      );

      await act(async () => {
        fireEvent.click(screen.getByTestId('pwa-check-button'));
      });
      expect(screen.getByTestId('pwa-status-text').textContent).toBe('Check failed');

      rerender(
        <VersionCheckControl
          manager={manager}
          disabled
          labels={{
            error: 'Check failed',
            offline: 'You are offline',
          }}
        />
      );
      expect((screen.getByTestId('pwa-check-button') as HTMLButtonElement).disabled).toBe(true);
    });
  });
});
