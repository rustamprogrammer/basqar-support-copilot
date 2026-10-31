import { execFileSync } from 'node:child_process';

export function readBuildInfo(root, mode) {
  let commit = null, dirty = null;
  try {
    const git = args => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true, timeout: 5000 }).trim();
    const revision = git(['rev-parse', 'HEAD']);
    if (/^[a-f0-9]{40,64}$/u.test(revision)) {
      commit = revision;
      dirty = git(['status', '--porcelain', '--untracked-files=normal']).length > 0;
    }
  } catch { /* An exported source archive has no verifiable Git revision. */ }
  return { commit, dirty, builtAt: new Date().toISOString(), mode };
}
