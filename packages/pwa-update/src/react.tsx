import React, { createContext, useContext, useEffect, useRef, useSyncExternalStore } from 'react';
import { getDefaultPwaUpdateManager, createPwaUpdateManager, type PwaUpdateManager } from './manager.js';
import type { PwaUpdateConfig, PwaUpdateContextValue, RegisterSWFn } from './types.js';

const PwaUpdateContext = createContext<PwaUpdateManager | null>(null);

export interface PwaUpdateProviderProps {
  children: React.ReactNode;
  /** Pre-constructed PwaUpdateManager instance. Takes precedence over `config`. */
  manager?: PwaUpdateManager;
  /** Configuration used if creating an internal manager for this provider. */
  config?: PwaUpdateConfig;
  /** Optional `registerSW` callback from `virtual:pwa-register` to invoke on mount. */
  registerSW?: RegisterSWFn;
}

export function PwaUpdateProvider({
  children,
  manager: externalManager,
  config,
  registerSW,
}: PwaUpdateProviderProps) {
  const internalManagerRef = useRef<PwaUpdateManager | null>(null);

  if (!externalManager && !internalManagerRef.current) {
    internalManagerRef.current = createPwaUpdateManager(config);
  }

  const activeManager = externalManager ?? internalManagerRef.current!;

  useEffect(() => {
    if (!registerSW) {
      return;
    }
    return activeManager.register(registerSW);
  }, [activeManager, registerSW]);

  useEffect(() => {
    const owned = internalManagerRef.current;
    return () => {
      if (!externalManager && owned) {
        owned.destroy();
      }
    };
  }, [externalManager]);

  return (
    <PwaUpdateContext.Provider value={activeManager}>{children}</PwaUpdateContext.Provider>
  );
}

export function usePwaUpdate(managerOverride?: PwaUpdateManager): PwaUpdateContextValue {
  const contextManager = useContext(PwaUpdateContext);
  const manager = managerOverride ?? contextManager ?? getDefaultPwaUpdateManager();

  const snapshot = useSyncExternalStore(
    manager.subscribe,
    manager.getSnapshot,
    manager.getSnapshot
  );

  return {
    ...snapshot,
    checkForUpdates: manager.checkForUpdates,
    applyUpdate: manager.applyUpdate,
    dismissPrompt: manager.dismissPrompt,
  };
}
