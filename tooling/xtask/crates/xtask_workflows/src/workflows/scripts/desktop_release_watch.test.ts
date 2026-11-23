// Which releases the desktop release watch checks, and what it posts. Run by
// xtask_workflows' tests.

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  DEADLINE_HOURS,
  describeRun,
  due,
  failedJobs,
  INSTALLERS,
  type Job,
  LOOK_BACK_HOURS,
  message,
  missingInstallers,
  type Release,
  type Run,
  windowStart,
} from './desktop_release_watch.ts';

const HOUR = 60 * 60 * 1000;

// The assets of v2026.11.19.1, cut to the desktop ones and one other.
const COMPLETE = [
  'darwin-aarch64.release.json',
  'Macro-2026.1119.1-aarch64-darwin.app.tar.gz',
  'Macro-2026.1119.1-aarch64-darwin.app.tar.gz.sig',
  'Macro-2026.1119.1-aarch64-darwin.dmg',
  'Macro-2026.1119.1-x86_64-linux.AppImage',
  'Macro-2026.1119.1-x86_64-linux.AppImage.sig',
  'macro-dmg-SHA256SUMS',
  'macrod-macos-aarch64.tar.gz',
];

const release = (tag: string, published: Date | null, assets: string[] = COMPLETE, rest: Partial<Release> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/o/r/releases/tag/${tag}`,
  draft: false,
  prerelease: false,
  published_at: published?.toISOString() ?? null,
  assets: assets.map((name) => ({ name })),
  ...rest,
});

const NOW = new Date('2026-11-23T12:00:00Z');
const hoursAgo = (hours: number) => new Date(NOW.getTime() - hours * HOUR);

describe('due', () => {
  const since = hoursAgo(1);

  test('picks a release whose deadline passed since the window started', () => {
    const picked = due([release('v2026.11.23.0', hoursAgo(DEADLINE_HOURS + 0.5))], since, NOW);
    assert.deepEqual(
      picked.map((each) => each.tag_name),
      ['v2026.11.23.0'],
    );
  });

  test('leaves releases still within their deadline, or checked before', () => {
    const picked = due(
      [release('v2026.11.23.1', hoursAgo(DEADLINE_HOURS - 0.5)), release('v2026.11.22.0', hoursAgo(DEADLINE_HOURS + 2))],
      since,
      NOW,
    );
    assert.deepEqual(picked, []);
  });

  test('takes the deadline at the window end, not at its start', () => {
    assert.equal(due([release('v1.2.3', hoursAgo(DEADLINE_HOURS))], since, NOW).length, 1);
    assert.equal(due([release('v1.2.3', hoursAgo(DEADLINE_HOURS + 1))], since, NOW).length, 0);
  });

  test('leaves drafts, prereleases and tags that are not production releases', () => {
    const published = hoursAgo(DEADLINE_HOURS + 0.5);
    const picked = due(
      [
        release('v2026.11.23.0', null, [], { draft: true }),
        release('desktop-stable', published, [], { prerelease: true }),
        release('v2026.11.23.1', published, [], { prerelease: true }),
        release('v2025.12.5.0.email-service', published, []),
        release('sdk-v1.2.3', published, []),
      ],
      since,
      NOW,
    );
    assert.deepEqual(picked, []);
  });
});

describe('missingInstallers', () => {
  test('finds nothing missing on a complete release', () => {
    assert.deepEqual(missingInstallers(release('v2026.11.19.1', NOW)), []);
  });

  test('names every installer of a release the desktop build never reached', () => {
    // v2026.11.12.0: both desktop builds failed; only macrod and the web app arrived.
    const assets = ['macrod-macos-aarch64.tar.gz', 'web-app-v2026.11.12.0.tar.gz'];
    assert.deepEqual(missingInstallers(release('v2026.11.12.0', NOW, assets)), [
      'macOS DMG',
      'macOS update archive',
      'macOS update signature',
      'Linux AppImage',
      'Linux update signature',
    ]);
  });

  test('names the signatures when installers arrived but signing never did', () => {
    const assets = COMPLETE.filter((name) => !name.endsWith('.sig'));
    assert.deepEqual(missingInstallers(release('v2026.11.19.1', NOW, assets)), [
      'macOS update signature',
      'Linux update signature',
    ]);
  });
});

describe('windowStart', () => {
  const run = (started: Date): Run => ({
    id: 1,
    html_url: 'u',
    status: 'completed',
    conclusion: 'success',
    run_started_at: started.toISOString(),
    created_at: started.toISOString(),
  });

  test('starts where the previous successful run started', () => {
    assert.deepEqual(windowStart(run(hoursAgo(3)), NOW), hoursAgo(3));
  });

  test('looks back no further than LOOK_BACK_HOURS', () => {
    assert.deepEqual(windowStart(run(hoursAgo(LOOK_BACK_HOURS * 3)), NOW), hoursAgo(LOOK_BACK_HOURS));
  });

  test('covers the last hour without a previous successful run', () => {
    assert.deepEqual(windowStart(undefined, NOW), hoursAgo(1));
  });
});

describe('describeRun', () => {
  const run: Run = {
    id: 43256865200,
    html_url: 'https://github.com/o/r/actions/runs/43256865200',
    status: 'completed',
    conclusion: 'failure',
    created_at: NOW.toISOString(),
  };

  test('names the failed jobs of a finished run', () => {
    const jobs: Job[] = [
      { name: 'Resolve build ref', conclusion: 'success' },
      { name: 'Build AppImage', conclusion: 'failure' },
      { name: 'Build macOS DMG', conclusion: 'cancelled' },
      { name: 'Publish desktop installers', conclusion: 'skipped' },
    ];
    assert.equal(
      describeRun(run, failedJobs(jobs)),
      '`Build Desktop on Tag` failed (Build AppImage, Build macOS DMG): [run](https://github.com/o/r/actions/runs/43256865200).',
    );
  });

  test('says when a run succeeded without attaching every installer', () => {
    assert.equal(
      describeRun({ ...run, conclusion: 'success' }, []),
      '`Build Desktop on Tag` succeeded: [run](https://github.com/o/r/actions/runs/43256865200).',
    );
  });

  test('says when the run is still waiting or running', () => {
    assert.equal(
      describeRun({ ...run, status: 'in_progress', conclusion: null }, []),
      '`Build Desktop on Tag` is still in progress: [run](https://github.com/o/r/actions/runs/43256865200).',
    );
  });

  test('says when the tag never started a run', () => {
    assert.equal(describeRun(undefined, []), '`Build Desktop on Tag` never ran for this tag.');
  });
});

describe('message', () => {
  test('names each release, what it misses and its run', () => {
    const text = message([
      { release: release('v2026.11.19.1', NOW), missing: ['macOS update signature'], run: 'RUN' },
      { release: release('v2026.11.12.0', NOW, []), missing: INSTALLERS.map(({ label }) => label), run: 'RUN' },
    ]);
    assert.equal(
      text,
      `🚨 Desktop installers missing from [v2026.11.19.1](https://github.com/o/r/releases/tag/v2026.11.19.1) ${DEADLINE_HOURS} h after it was published: macOS update signature. RUN\n\n` +
        `🚨 No desktop installers on [v2026.11.12.0](https://github.com/o/r/releases/tag/v2026.11.12.0) ${DEADLINE_HOURS} h after it was published. RUN`,
    );
  });
});
