# `@qozara/pwa-kit`

Shared, iOS-resilient Progressive Web App (PWA) update lifecycle manager, React 18/19 hooks & customizable UI components, and Vite build-version plugin for Qozara web applications.

---

## Why This Exists (The iOS Home Screen PWA Update Bug)

On iOS Safari **standalone Home Screen PWAs**, WebKit runs the installed app in an isolated Service Worker container where `navigator.serviceWorker.getRegistration()` and `registration.update()` can hang indefinitely or silently stall while background precaching is in progress. Naive PWA wrappers either spin forever or fall through timeouts and falsely display *"Up to Date"* on an obsolete commit.

`@qozara/pwa-kit` solves this with a **dual-layer update lifecycle**:

1. **Out-of-Band Build Manifest (`/version.json`)**:
   `@qozara/pwa-vite` resolves a deterministic 7-character Git commit hash at build time (`VERCEL_GIT_COMMIT_SHA` -> `GITHUB_SHA` -> `git rev-parse HEAD`), injects it via Vite `define`, and emits an uncached `/version.json` file excluded from Workbox precaching.
2. **Self-Healing Update State Machine (`PwaUpdateManager`)**:
   `@qozara/pwa-update` runs Service Worker checks **in parallel** with a `cache: 'no-store'` fetch to `/version.json?_t=<timestamp>`.
   - If the Service Worker finishes staging cleanly -> applies standard `SKIP_WAITING` + `controllerchange` reload.
   - If `/version.json` reports a newer commit while iOS hangs `registration.update()` -> surfaces **Update Available** after a short grace window (`swGracePeriodMs`, default `1500ms`) and performs targeted **self-healing recovery** on reload (unregisters wedged Service Workers and deletes only Workbox/shell precaches, leaving IndexedDB, `localStorage`, and app caches intact).
   - Timeouts and network errors return distinct `'timeout'` / `'error'` results — never falsely claiming *"Up to Date"*.

---

## Packages

| Package | Runtime | Description |
| :--- | :--- | :--- |
| **`@qozara/pwa-vite`** | Node / Vite 5–7 | `qozaraPwaVersionPlugin`, `resolveGitVersion`, `PWA_VERSION_GLOB_IGNORES`, and `PWA_VERCEL_NO_CACHE_HEADERS`. |
| **`@qozara/pwa-update`** | Browser + React 18/19 | Framework-agnostic `PwaUpdateManager` (`useSyncExternalStore` bindings, `PwaUpdateProvider`, singleton helpers, plus unstyled accessible `PwaUpdateBanner` & `VersionCheckControl`). |

---

## Quickstart

### 1. Vite Configuration (`vite.config.ts`)

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { qozaraPwaVersionPlugin, PWA_VERSION_GLOB_IGNORES } from '@qozara/pwa-vite';

export default defineConfig({
  plugins: [
    react(),
    qozaraPwaVersionPlugin({
      defineKey: '__APP_VERSION__', // Optional, defaults to '__APP_VERSION__'
    }),
    VitePWA({
      registerType: 'prompt',
      workbox: {
        cleanupOutdatedCaches: true,
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        globIgnores: [...PWA_VERSION_GLOB_IGNORES],
        navigateFallback: 'index.html',
      },
    }),
  ],
});
```

### 2. HTTP Cache Headers (`vercel.json`)

Ensure your CDN / static host never caches `/sw.js`, `/version.json`, or `/index.html`, and excludes `/sw.js`, `/workbox-*.js`, and `/version.json` from SPA HTML rewrites:

```json
{
  "rewrites": [
    {
      "source": "/((?!assets/|sw\\.js|workbox-.*\\.js|version\\.json|favicon.*|logo\\.svg|manifest\\.json|.*\\.png|.*\\.ico).*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/(sw\\.js|version\\.json|index\\.html)",
      "headers": [
        { "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }
      ]
    }
  ]
}
```

### 3. Application Wiring (`@qozara/pwa-update`)

#### Option A — Provider Pattern (Recommended for React Context Trees)

```tsx
import { registerSW } from 'virtual:pwa-register';
import { PwaUpdateProvider, createPwaUpdateManager, usePwaUpdate } from '@qozara/pwa-update';

const pwaManager = createPwaUpdateManager({
  currentVersion: __APP_VERSION__,
  onUpdateAvailable: () => {
    // Optionally trigger app-specific toast notifications
  },
});

export function App() {
  return (
    <PwaUpdateProvider manager={pwaManager} registerSW={registerSW}>
      <MyRoutes />
    </PwaUpdateProvider>
  );
}
```

#### Option B — Imperative Entry Point (`main.tsx` + `usePwaUpdate()`)

```ts
import { registerSW } from 'virtual:pwa-register';
import { configurePwaUpdate, registerPwaServiceWorker } from '@qozara/pwa-update';

configurePwaUpdate({ currentVersion: __APP_VERSION__ });
registerPwaServiceWorker(registerSW);
```

Anywhere in your React tree:

```tsx
import { usePwaUpdate } from '@qozara/pwa-update';

function VersionFooter() {
  const { needRefresh, isChecking, lastCheckResult, checkForUpdates, applyUpdate } = usePwaUpdate();
  // Render app-native buttons using your i18n dictionary & theme
}
```

### 4. Optional Pre-Built Unstyled Components

If you want drop-in WCAG 2.2 accessible markup (`role="status"`, `aria-live="polite"`) styled with your own Tailwind/CSS classes and i18n labels:

```tsx
import { PwaUpdateBanner, VersionCheckControl } from '@qozara/pwa-update';

<PwaUpdateBanner
  showAvailableVersion
  labels={{
    title: t('pwa.updateAvailableTitle'),
    description: t('pwa.updateAvailableDesc'),
    reload: t('pwa.reload'),
    dismiss: t('pwa.dismiss'),
  }}
  classNames={{
    root: 'fixed bottom-4 inset-x-4 rounded-xl bg-slate-900 p-4 flex justify-between',
    reloadButton: 'px-3 py-2 bg-emerald-500 text-slate-950 rounded-lg font-bold',
  }}
/>

<VersionCheckControl
  labels={{
    versionLabel: 'Version {{version}}',
    checkForUpdates: t('pwa.checkForUpdates'),
    checking: t('pwa.checkingForUpdates'),
    upToDate: t('pwa.upToDate'),
    updateNow: t('pwa.reload'),
  }}
/>
```

---

## Development & Verification

```bash
npm install
npm run check   # TypeScript strict check
npm run lint    # ESLint 9 across all packages and tests
npm run build   # Build ESM + DTS bundles via tsup
npm test        # Vitest unit & jsdom component tests
```
