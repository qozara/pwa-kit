// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import {
  PwaUpdateProvider,
  usePwaUpdate,
  createPwaUpdateManager,
  configurePwaUpdate,
  registerPwaServiceWorker,
  resetPwaUpdateManager,
} from '../src/index.js';

function HookProbe() {
  const {
    needRefresh,
    isChecking,
    isUpdating,
    availableVersion,
    lastCheckResult,
    checkForUpdates,
    applyUpdate,
    dismissPrompt,
  } = usePwaUpdate();

  return (
    <div>
      <span data-testid="need-refresh">{String(needRefresh)}</span>
      <span data-testid="is-checking">{String(isChecking)}</span>
      <span data-testid="is-updating">{String(isUpdating)}</span>
      <span data-testid="available-version">{availableVersion ?? 'none'}</span>
      <span data-testid="last-result">{lastCheckResult ?? 'none'}</span>
      <button data-testid="check-btn" onClick={() => void checkForUpdates()}>
        Check
      </button>
      <button data-testid="apply-btn" onClick={() => void applyUpdate()}>
        Apply
      </button>
      <button data-testid="dismiss-btn" onClick={() => dismissPrompt()}>
        Dismiss
      </button>
    </div>
  );
}

describe('PwaUpdateProvider and usePwaUpdate', () => {
  beforeEach(() => {
    resetPwaUpdateManager();
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true,
    });
  });

  afterEach(() => {
    cleanup();
    resetPwaUpdateManager();
    vi.restoreAllMocks();
  });

  it('subscribes to an explicit PwaUpdateProvider manager and reflects state changes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '156003f' }), { status: 200 })
    );
    const manager = createPwaUpdateManager({
      currentVersion: '263c0d5',
      swGracePeriodMs: 10,
      fetchImpl: fetchMock as unknown as typeof fetch,
      onReload: vi.fn(),
    });

    const registerSWMock = vi.fn(() => vi.fn().mockResolvedValue(undefined));

    render(
      <PwaUpdateProvider manager={manager} registerSW={registerSWMock}>
        <HookProbe />
      </PwaUpdateProvider>
    );

    expect(registerSWMock).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('need-refresh').textContent).toBe('false');

    await act(async () => {
      fireEvent.click(screen.getByTestId('check-btn'));
    });

    expect(screen.getByTestId('need-refresh').textContent).toBe('true');
    expect(screen.getByTestId('available-version').textContent).toBe('156003f');
    expect(screen.getByTestId('last-result').textContent).toBe('update_available');

    act(() => {
      fireEvent.click(screen.getByTestId('dismiss-btn'));
    });
    expect(manager.getSnapshot().isPromptDismissed).toBe(true);
  });

  it('works with standalone singleton configuration without a Provider', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: '156003f' }), { status: 200 })
    );

    configurePwaUpdate({
      currentVersion: '156003f',
      swGracePeriodMs: 10,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    let capturedOnNeedRefresh: (() => void) | undefined;
    const registerCleanup = registerPwaServiceWorker(
      vi.fn((opts) => {
        capturedOnNeedRefresh = opts?.onNeedRefresh;
        return vi.fn().mockResolvedValue(undefined);
      })
    );

    render(<HookProbe />);

    expect(screen.getByTestId('need-refresh').textContent).toBe('false');

    await act(async () => {
      fireEvent.click(screen.getByTestId('check-btn'));
    });
    expect(screen.getByTestId('last-result').textContent).toBe('up_to_date');

    act(() => {
      capturedOnNeedRefresh?.();
    });
    expect(screen.getByTestId('need-refresh').textContent).toBe('true');

    registerCleanup();
  });
});
