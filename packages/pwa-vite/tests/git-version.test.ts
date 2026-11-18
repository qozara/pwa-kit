import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveGitVersion } from '../src/git-version.js';

describe('resolveGitVersion', () => {
  it('prefers VERCEL_GIT_COMMIT_SHA truncated to 7 characters by default', () => {
    const version = resolveGitVersion({
      env: {
        VERCEL_GIT_COMMIT_SHA: '  156003f99fc15cf2ee15a600573d2d038ab9b942  ',
        GITHUB_SHA: 'abcdef1234567890',
      },
    });
    expect(version).toBe('156003f');
  });

  it('falls back to GITHUB_SHA truncated to 7 characters when VERCEL_GIT_COMMIT_SHA is blank', () => {
    const version = resolveGitVersion({
      env: {
        VERCEL_GIT_COMMIT_SHA: '   ',
        GITHUB_SHA: '263c0d515aa0b65a703a453fbbd7fba2e9c1b386',
      },
    });
    expect(version).toBe('263c0d5');
  });

  it('supports custom length truncation', () => {
    const version = resolveGitVersion({
      length: 10,
      env: {
        VERCEL_GIT_COMMIT_SHA: '156003f99fc15cf2ee15a600573d2d038ab9b942',
      },
    });
    expect(version).toBe('156003f99f');
  });

  it('falls back to git rev-parse HEAD when CI env vars are absent', () => {
    const expectedHead = execSync('git rev-parse HEAD', { cwd: import.meta.dirname })
      .toString()
      .trim()
      .slice(0, 7);
    const version = resolveGitVersion({ env: {}, cwd: import.meta.dirname });
    expect(version).toBe(expectedHead);
    expect(version).toHaveLength(7);
  });

  it('returns fallback when git command fails outside a git repository', () => {
    const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-vite-nogit-'));
    try {
      const version = resolveGitVersion({
        env: {},
        cwd: nonGitDir,
      });
      expect(version).toBe('dev');

      const customFallback = resolveGitVersion({
        env: {},
        cwd: nonGitDir,
        fallback: 'local-unknown',
      });
      expect(customFallback).toBe('local-unknown');
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });
});
