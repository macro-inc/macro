import base from '/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync/apps/web/src/lib/queries/vitest.config.ts';
const b: any = base;
export default { ...b, root: '/home/teo/.herdr/worktrees/macro/synoet-channels-local-sync/apps/web', server: { fs: { strict: false } }, test: { ...b.test, include: ['/tmp/claude-1001/-home-teo--herdr-worktrees-macro-synoet-channels-local-sync/5c052d5a-35e5-475f-8f8a-ea1c0034b3ce/scratchpad/probe.test.ts'], name: 'probe' } };
