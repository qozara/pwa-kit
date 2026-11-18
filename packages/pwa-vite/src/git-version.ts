import { execSync } from 'node:child_process';

export interface ResolveGitVersionOptions {
  /** Number of commit hash characters to retain. Defaults to 7. */
  length?: number;
  /** Fallback string returned if neither CI env vars nor git history are available. Defaults to 'dev'. */
  fallback?: string;
  /** Environment variable map to inspect. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Working directory used when invoking `git rev-parse HEAD`. */
  cwd?: string;
}

/**
 * Resolves a short deterministic commit hash for build-time version tracking.
 * Preference order: VERCEL_GIT_COMMIT_SHA -> GITHUB_SHA -> `git rev-parse HEAD` -> fallback.
 */
export function resolveGitVersion(options: ResolveGitVersionOptions = {}): string {
  const {
    length = 7,
    fallback = 'dev',
    env = process.env,
    cwd,
  } = options;

  const vercelSha = env.VERCEL_GIT_COMMIT_SHA?.trim();
  if (vercelSha) {
    return vercelSha.slice(0, length);
  }

  const githubSha = env.GITHUB_SHA?.trim();
  if (githubSha) {
    return githubSha.slice(0, length);
  }

  try {
    const gitSha = execSync('git rev-parse HEAD', {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim();
    if (gitSha) {
      return gitSha.slice(0, length);
    }
  } catch {
    // Non-git build environments fall back safely below.
  }

  return fallback;
}
