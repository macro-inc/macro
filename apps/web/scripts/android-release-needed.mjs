import { appendFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  androidChangeReasons,
  androidNativeHash,
  androidVersionCode,
  gitIn,
  tauriPath,
} from './android-native.mjs';

const releaseTag = /^v20\d{2}\.\d{1,2}\.\d{1,2}(?:\.\d{1,2})?$/;

export function androidReleaseDecision({ releases, cwd = process.cwd() }) {
  const git = gitIn(cwd);
  const head = git(['rev-parse', '--verify', 'HEAD^{commit}']);
  const candidates = new Map();
  for (const release of releases) {
    const tag = release.tag_name;
    if (release.draft || release.prerelease || !releaseTag.test(tag)) continue;
    const stem = `macro-${tag}-android-arm64`;
    const assets = new Set(
      release.assets
        .filter((asset) => asset.state === 'uploaded' && asset.size > 0)
        .map((asset) => asset.name)
    );
    if (
      !['.aab', '.aab.sha256', '-mapping.txt', '-mapping.txt.sha256'].every(
        (suffix) => assets.has(`${stem}${suffix}`)
      )
    )
      continue;
    // Missing tags/history must fail, rather than silently reuse a version code.
    const commit = git(['rev-parse', '--verify', `refs/tags/${tag}^{commit}`]);
    candidates.set(commit, tag);
  }

  // API release ordering can differ from commit order. Only consider ancestors
  // of this release, and prefer the closest one in topological history order.
  const baseline = git(['rev-list', '--topo-order', head])
    .split('\n')
    .find((commit) => candidates.has(commit));
  if (!baseline) {
    return {
      build: true,
      summary:
        'Build the first AAB: no ancestor release has complete Android artifacts.',
    };
  }
  const tag = candidates.get(baseline);
  if (androidNativeHash(git, head) === androidNativeHash(git, baseline)) {
    return {
      build: false,
      summary: `Skip Android: the Android native code (${tauriPath}/ and the client cache wasm version) is unchanged since ${tag}. App updates use the bundle updater.`,
    };
  }
  const reason = `${androidChangeReasons(git, baseline, head).join(' and ')} since ${tag}`;
  if (androidVersionCode(git, head) <= androidVersionCode(git, baseline)) {
    throw new Error(
      `Native code changed (${reason}), but Android versionCode did not increase. Run just android-bump in apps/web and commit before tagging.`
    );
  }
  return {
    build: true,
    summary: `Build Android: ${reason}.`,
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const repository = process.env.GITHUB_REPOSITORY;
    if (!repository || !/^[\w.-]+\/[\w.-]+$/.test(repository))
      throw new Error('GITHUB_REPOSITORY must identify the release repository');
    const pages = JSON.parse(
      execFileSync(
        'gh',
        [
          'api',
          '--paginate',
          '--slurp',
          `repos/${repository}/releases?per_page=100`,
        ],
        { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
      )
    );
    const decision = androidReleaseDecision({ releases: pages.flat() });
    console.log(decision.summary);
    if (process.env.GITHUB_OUTPUT)
      await appendFile(process.env.GITHUB_OUTPUT, `build=${decision.build}\n`);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(
        process.env.GITHUB_STEP_SUMMARY,
        `${decision.summary}\n`
      );
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'Android release detection failed'
    );
    process.exitCode = 1;
  }
}
