import { afterEach, expect, test } from 'bun:test';
import { disk, shell } from '../../../context/index.ts';
import { output } from '../../../context/shell.ts';
import { commit } from '../commit.ts';
import {
  ciVerdict,
  land,
  localRow,
  mergeRow,
  worktreeCheck,
  worktreeOf,
} from '../land.ts';
import { type Sandbox, sandbox } from './sandbox.ts';

const made: Sandbox[] = [];
const setup = async () => {
  const box = await sandbox();
  made.push(box);
  return { box, worktree: await box.feature() };
};
afterEach(async () => {
  for (const box of made.splice(0)) await box.remove();
});

const job = 'check';

test('ciVerdict: only the check job on exactly this SHA, on Actions', () => {
  const run = {
    name: job,
    status: 'completed',
    conclusion: 'success',
    head_sha: 'a',
    app: 'github-actions',
  };
  expect(ciVerdict([run], 'a', job)).toBe('green');
  expect(ciVerdict([run], 'b', job)).toBe('pending');
  expect(ciVerdict([], 'a', job)).toBe('pending');
  expect(
    ciVerdict([{ ...run, status: 'in_progress', conclusion: null }], 'a', job)
  ).toBe('pending');
  expect(ciVerdict([{ ...run, conclusion: 'failure' }], 'a', job)).toBe('red');
  expect(
    ciVerdict(
      [run, { ...run, name: 'other', conclusion: 'cancelled' }],
      'a',
      job
    )
  ).toBe('red');
  expect(ciVerdict([{ ...run, app: 'somebody-else' }], 'a', job)).toBe(
    'pending'
  );
  expect(ciVerdict([{ ...run, name: 'lint' }], 'a', job)).toBe('pending');
});

test('merge rows', () => {
  expect(
    mergeRow(
      'example/widgets',
      12,
      { title: 'Add X | Y', mergedAt: '2026-11-03T10:15:42Z' },
      'did x'
    )
  ).toBe('| 2026-11-03T10:15 | widgets#12 | Add X | Y | did x |');
  expect(
    localRow('feat', 'abcdef0123456789', '2026-11-03T10:15:42Z', 'did x')
  ).toBe('| 2026-11-03T10:15 | local@abcdef012345 | feat | did x |');
});

test('the worktree that has a branch out', () => {
  const listing =
    'worktree /live\nHEAD a\nbranch refs/heads/main\n\nworktree /wt\nHEAD b\nbranch refs/heads/feat\n';
  expect(worktreeOf(listing, 'feat')).toBe('/wt');
  expect(worktreeOf(listing, 'fea')).toBeUndefined();
});

test('lands by fast-forward: same SHA on main, live tree updated, HEAD untouched, GitHub told', async () => {
  const { box, worktree } = await setup();
  const sha = (await box.git(worktree, 'rev-parse', 'HEAD')).trim();
  // Committed by the flush, like any state.
  await box.write(`${box.live}/untracked.tmp`, 'keep');
  const landed = await land(
    box.repository(),
    'feat',
    'what it did',
    box.landDeps()
  );
  expect(landed).toEqual({
    status: 'landed',
    sha: expect.any(String),
    pr: 7,
    merged: true,
    restarting: false,
  });
  expect(await box.git(box.live, 'symbolic-ref', '--short', 'HEAD')).toBe(
    'main\n'
  );
  expect(await box.read(`${box.live}/code.ts`)).toContain('FIVE');
  expect(await box.git(box.live, 'status', '--porcelain')).toBe('');
  if (landed.status === 'landed') {
    // The flush moved main under the branch, so the SHA is the rebased one.
    expect(landed.sha).not.toBe(sha);
    expect(
      (
        await box.raw(box.live, [
          'merge-base',
          '--is-ancestor',
          landed.sha,
          'main',
        ])
      ).code
    ).toBe(0);
  }
  expect(await box.subjects(box.remote)).toStartWith(
    'merge log: #7\nfeat: change\nland: state before feat\ninit'
  );
  expect(box.merges).toHaveLength(1);
  expect(box.merges[0]).toBe(
    '| 2026-11-09T15:00 | agent#7 | Feat | what it did |'
  );
  expect(
    (
      await box.raw(box.remote, [
        'rev-parse',
        '--verify',
        '-q',
        'refs/heads/feat',
      ])
    ).code
  ).toBe(1);
  expect(box.lock.held).toBe(false);
});

test('a branch already on main lands with the exact SHA the check saw, no rebase', async () => {
  const { box, worktree } = await setup();
  const sha = (await box.git(worktree, 'rev-parse', 'HEAD')).trim();
  const seen: string[] = [];
  const landed = await land(
    box.repository(),
    'feat',
    '',
    box.landDeps({
      ci: async (checked) => {
        seen.push(checked);
        return 'green';
      },
    })
  );
  expect(landed.status).toBe('landed');
  expect(seen).toEqual([sha]);
  expect((await box.git(worktree, 'rev-parse', 'HEAD')).trim()).toBe(sha);
});

test('a state commit made before landing: the branch is rebased, pushed, and checked on the new SHA', async () => {
  const { box, worktree } = await setup();
  await box.write(`${box.live}/state/memory/notes.md`, 'n2\n');
  expect(await commit(box.repository(), 'tick: state', 0)).toBe('pushed');
  const seen: string[] = [];
  const landed = await land(
    box.repository(),
    'feat',
    '',
    box.landDeps({
      ci: async (checked) => {
        seen.push(checked);
        return 'green';
      },
    })
  );
  expect(landed.status).toBe('landed');
  expect(seen).toEqual([(await box.git(worktree, 'rev-parse', 'HEAD')).trim()]);
  expect(await box.subjects(box.remote)).toStartWith(
    'merge log: #7\nfeat: change\ntick: state\ninit'
  );
});

test("a commit racing a landing can't move main: it stays out, and its edit lands right after", async () => {
  const { box } = await setup();
  let during = '';
  const landed = await land(
    box.repository(),
    'feat',
    '',
    box.landDeps({
      ci: async () => {
        await box.write(
          `${box.live}/state/memory/notes.md`,
          'written during the check\n'
        );
        during = await commit(box.repository(), 'self-edit: notes.md', 0);
        return 'green';
      },
    })
  );
  expect(during).toBe('locked');
  expect(landed.status).toBe('landed');
  expect(await box.git(box.live, 'status', '--porcelain')).toBe('');
  expect(await box.git(box.remote, 'show', 'main:state/memory/notes.md')).toBe(
    'written during the check\n'
  );
});

test('an uncommitted edit to a file the branch changes stops the fast-forward, then lands on top of it', async () => {
  const { box, worktree } = await setup();
  let first = true;
  const landed = await land(
    box.repository(),
    'feat',
    '',
    box.landDeps({
      ci: async () => {
        if (first)
          await box.write(
            `${box.live}/code.ts`,
            'ONE\ntwo\nthree\nfour\nfive\n'
          );
        first = false;
        return 'green';
      },
    })
  );
  expect(landed.status).toBe('landed');
  expect(await box.read(`${box.live}/code.ts`)).toBe(
    'ONE\ntwo\nthree\nfour\nFIVE\n'
  );
  expect(await box.subjects(worktree, 'HEAD')).toStartWith(
    'feat: change\nland: state before feat\ninit'
  );
});

test('the check red, or never finished: main stays put', async () => {
  const { box } = await setup();
  const before = await box.git(box.live, 'rev-parse', 'main');
  expect(
    await land(
      box.repository(),
      'feat',
      '',
      box.landDeps({ ci: async () => 'red' })
    )
  ).toEqual({
    status: 'refused',
    reason: expect.stringContaining('check failed'),
  });
  expect(
    await land(
      box.repository(),
      'feat',
      '',
      box.landDeps({ ci: async () => 'pending', ciTimeoutMs: 5 })
    )
  ).toEqual({
    status: 'refused',
    reason: expect.stringContaining("didn't finish"),
  });
  expect(await box.git(box.live, 'rev-parse', 'main')).toBe(before);
  expect(await box.git(box.remote, 'rev-parse', 'main')).toBe(before);
  expect(box.lock.held).toBe(false);
});

test('refuses without a PR, with the wrong base, for main itself, and off main', async () => {
  const { box } = await setup();
  const github = (
    pr: { number: number; title: string; baseRefName: string } | undefined
  ) =>
    box.landDeps({
      github: {
        repo: 'example/agent',
        pr: async () => pr,
        merged: async () => true,
      },
    });
  expect(
    await land(box.repository(), 'feat', '', github(undefined))
  ).toMatchObject({
    status: 'refused',
    reason: expect.stringContaining('no open PR'),
  });
  expect(
    await land(
      box.repository(),
      'feat',
      '',
      github({ number: 1, title: 't', baseRefName: 'dev' })
    )
  ).toMatchObject({ reason: expect.stringContaining('targets dev') });
  expect(
    await land(box.repository(), 'main', '', box.landDeps())
  ).toMatchObject({ reason: expect.stringContaining('no local branch') });
  expect(
    await land(box.repository(), 'nope', '', box.landDeps())
  ).toMatchObject({ reason: expect.stringContaining('no local branch') });
  await box.git(box.live, 'checkout', '-q', '-b', 'side');
  expect(
    await land(box.repository(), 'feat', '', box.landDeps())
  ).toMatchObject({ reason: expect.stringContaining('not main') });
});

test('a conflicting rebase is aborted; branch and main unchanged', async () => {
  const { box, worktree } = await setup();
  await box.write(`${box.live}/code.ts`, 'one\ntwo\nthree\nfour\nTHEIRS\n');
  await commit(box.repository(), 'edit', 0);
  const branch = await box.git(worktree, 'rev-parse', 'HEAD');
  expect(
    await land(box.repository(), 'feat', '', box.landDeps())
  ).toMatchObject({
    status: 'refused',
    reason: expect.stringContaining("doesn't rebase cleanly"),
  });
  expect(await box.git(worktree, 'rev-parse', 'HEAD')).toBe(branch);
  expect(await box.git(worktree, 'status', '--porcelain')).toBe('');
});

test('a branch nobody has checked out rebases in a temporary worktree; the live checkout stays on main', async () => {
  const { box, worktree } = await setup();
  await box.git(box.live, 'worktree', 'remove', '--force', worktree);
  await box.write(`${box.live}/state/memory/notes.md`, 'moved\n');
  const landed = await land(box.repository(), 'feat', '', box.landDeps());
  expect(landed.status).toBe('landed');
  expect(await box.git(box.live, 'symbolic-ref', '--short', 'HEAD')).toBe(
    'main\n'
  );
  expect(
    (await box.git(box.live, 'worktree', 'list')).trim().split('\n')
  ).toHaveLength(1);
});

test('the owner pushed meanwhile: the landing pulls it and lands on top, with nothing lost', async () => {
  const { box } = await setup();
  await box.theirs('owner.md', 'from the owner\n');
  const landed = await land(box.repository(), 'feat', '', box.landDeps());
  expect(landed.status).toBe('landed');
  expect(await box.read(`${box.live}/owner.md`)).toBe('from the owner\n');
  expect(await box.read(`${box.live}/code.ts`)).toContain('FIVE');
  expect(await box.subjects(box.remote)).toStartWith(
    'merge log: #7\nfeat: change\ntheirs: owner.md\ninit'
  );
  expect(box.sent).toEqual([]);
});

test("with no remote: no PR, the repository's own check decides, nothing is pushed, and the merge log has a row", async () => {
  const { box, worktree } = await setup();
  await box.git(box.live, 'remote', 'remove', 'origin');
  const sha = (await box.git(worktree, 'rev-parse', 'HEAD')).trim();
  const seen: string[] = [];
  const local = (state: 'green' | 'red') =>
    box.landDeps({
      github: undefined,
      ci: async (checked) => {
        seen.push(checked);
        return state;
      },
    });
  expect(await land(box.repository(), 'feat', '', local('red'))).toMatchObject({
    status: 'refused',
  });
  expect(
    await land(box.repository(), 'feat', 'did it', local('green'))
  ).toEqual({
    status: 'landed',
    sha,
    pr: undefined,
    merged: false,
    restarting: false,
  });
  expect(seen).toEqual([sha, sha]);
  expect(await box.read(`${box.live}/code.ts`)).toContain('FIVE');
  expect(await box.subjects(box.live)).toStartWith(
    'merge log: feat\nfeat: change\ninit'
  );
  expect(box.merges).toEqual([
    `| 2026-11-09T15:00 | local@${sha.slice(0, 12)} | feat | did it |`,
  ]);
  expect(await box.subjects(box.remote)).toBe('init\n');
  expect(box.sent).toEqual([]);
});

/** The repository's own check as `land` runs it without GitHub, with `bun run check` stood in for by a script that passes only on GOOD. */
const ownCheck = (box: Sandbox) =>
  worktreeCheck({
    repository: box.repository(),
    checkouts: {
      make: async () => {
        const worktrees = `${box.live}/.worktrees`;
        await output(shell, ['mkdir', '-p', worktrees]);
        return (await output(shell, ['mktemp', '-d', '-p', worktrees])).trim();
      },
      remove: (path) => disk.remove(path),
    },
    run: (argv, { cwd }) => shell.run(argv, { cwd }),
    check: ['sh', '-c', `pwd >> '${box.root}/where'; grep -q GOOD code.ts`],
    failed: async (sha) => {
      box.logged.push(`check failed on ${sha.slice(0, 12)}`);
    },
  });

test('without GitHub: the check runs in a worktree under .worktrees; red refuses with main untouched, green lands, pushes and restarts', async () => {
  const { box, worktree } = await setup();
  const restarts: string[] = [];
  const deps = box.landDeps({
    github: undefined,
    ci: ownCheck(box),
    restart: async () => {
      restarts.push(await box.remoteSha());
    },
  });
  const before = await box.git(box.live, 'rev-parse', 'main');

  const red = await land(box.repository(), 'feat', '', deps);
  expect(red).toMatchObject({
    status: 'refused',
    reason: expect.stringContaining('check failed'),
  });
  expect(await box.git(box.live, 'rev-parse', 'main')).toBe(before);
  expect(await box.remoteSha()).toBe(before.trim());
  expect(await box.read(`${box.live}/code.ts`)).not.toContain('FIVE');
  expect(restarts).toEqual([]);
  expect(box.logged).toHaveLength(1);

  await box.write(`${worktree}/code.ts`, 'one\ntwo\nthree\nfour\nFIVE GOOD\n');
  await box.git(worktree, 'commit', '-qam', 'feat: good');
  const green = await land(box.repository(), 'feat', 'did it', deps);
  expect(green).toMatchObject({ status: 'landed', restarting: true });
  expect(await box.read(`${box.live}/code.ts`)).toContain('FIVE GOOD');
  // Pushed before the restart: what the agent restarts onto is on the remote.
  const pushed = (await box.git(box.live, 'rev-parse', 'main')).trim();
  expect(await box.remoteSha()).toBe(pushed);
  expect(restarts).toEqual([pushed]);
  expect(await box.subjects(box.remote)).toStartWith(
    'merge log: feat\nfeat: good\nfeat: change\ninit'
  );

  // Each check ran in its own worktree under .worktrees, and none is left.
  const where = ((await box.read(`${box.root}/where`)) ?? '')
    .split('\n')
    .filter((line) => line !== '');
  expect(where).toHaveLength(2);
  for (const line of where) expect(line).toStartWith(`${box.live}/.worktrees/`);
  expect(
    (await box.git(box.live, 'worktree', 'list')).trim().split('\n')
  ).toHaveLength(2);
});

test('a branch that changes bun.lock or a package.json dependency is refused: the image has no other packages', async () => {
  const { box, worktree } = await setup();
  const deps = box.landDeps({ github: undefined, ci: ownCheck(box) });
  const before = await box.git(box.live, 'rev-parse', 'main');
  await box.write(`${worktree}/code.ts`, 'GOOD\n');
  await box.write(
    `${worktree}/package.json`,
    '{"dependencies":{"left-pad":"1.3.0"}}\n'
  );
  await box.git(worktree, 'add', '-A');
  await box.git(worktree, 'commit', '-qm', 'feat: a dependency');
  expect(await land(box.repository(), 'feat', '', deps)).toMatchObject({
    status: 'refused',
    reason: expect.stringContaining('dependency changes need a new image'),
  });
  expect(await box.git(box.live, 'rev-parse', 'main')).toBe(before);

  await box.write(`${worktree}/package.json`, '{}\n');
  await box.write(`${worktree}/bun.lock`, '{"lockfileVersion":1}\n');
  await box.git(worktree, 'add', '-A');
  await box.git(worktree, 'commit', '-qm', 'feat: a lockfile');
  expect(await land(box.repository(), 'feat', '', deps)).toMatchObject({
    status: 'refused',
    reason: expect.stringContaining('dependency changes need a new image'),
  });
});

test('a package.json change that leaves its dependencies alone is checked and lands', async () => {
  const { box, worktree } = await setup();
  const deps = box.landDeps({ github: undefined, ci: ownCheck(box) });
  await box.write(`${worktree}/code.ts`, 'GOOD\n');
  await box.write(`${worktree}/package.json`, '{"scripts":{"check":"true"}}\n');
  await box.git(worktree, 'add', '-A');
  await box.git(worktree, 'commit', '-qm', 'feat: a script');
  expect(await land(box.repository(), 'feat', '', deps)).toMatchObject({
    status: 'landed',
  });
});
