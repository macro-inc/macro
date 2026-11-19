import { readFileSync, writeFileSync } from 'node:fs';
const sub = (file: string, a: string | RegExp, b: string) => {
  const t = readFileSync(file, 'utf8'); const n = t.replace(a, () => b);
  if (n === t) throw new Error('missing in ' + file); writeFileSync(file, n);
};
const t = 'apps/web/tests/channels-e2e/';
sub(t + 'README.md', /\| `VITE_ENABLE_CHANNEL_LOCAL_SYNC` \| Set to `true` when[^\n]*\|/, "| `VITE_ENABLE_CHANNEL_LOCAL_SYNC` | Set to `true` when the app under test was built with it, as CI does for both the build and the run: only that build keeps channels on the device, and some known defects exist only with the flag, others only without. |");
sub(t + 'AGENTS.md', /- Channels are kept on the device only by a build with\n[^\n]*\n[^\n]*\n[^\n]*\n/, "- Channels are kept on the device only by a build with\n  `VITE_ENABLE_CHANNEL_LOCAL_SYNC=true`, which has no default; without it\n  channel messages go over REST. That flag alone tells the suite's two builds\n  apart, and CI runs both.\n");
