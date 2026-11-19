import { readFileSync, writeFileSync } from 'node:fs';
const sub = (file: string, a: string, b: string) => {
  const t = readFileSync(file, 'utf8');
  if (!t.includes(a)) throw new Error('missing in ' + file + ': ' + a.slice(0, 50));
  writeFileSync(file, t.replace(a, b));
};
sub('tooling/xtask/crates/xtask_workflows/src/workflows/channels_e2e.rs',
`/// \`graphql\` is the value the app is built with for \`VITE_ENABLE_GRAPHQL_SOUP\`.`,
`/// \`graphql\` is the value the app is built with for \`VITE_ENABLE_GRAPHQL_SOUP\`
/// and for \`VITE_ENABLE_CHANNEL_LOCAL_SYNC\`, which keeps channels on the
/// device and has no default: the suite's device tests need both.`);
sub('tooling/xtask/crates/xtask_workflows/src/workflows/channels_e2e.rs',
`        .add_env(("VITE_ENABLE_GRAPHQL_SOUP", graphql))`,
`        .add_env(("VITE_ENABLE_GRAPHQL_SOUP", graphql))
        .add_env(("VITE_ENABLE_CHANNEL_LOCAL_SYNC", graphql))`);
sub('apps/web/tests/channels-e2e/README.md',
"| `VITE_ENABLE_GRAPHQL_SOUP` | Set to `true` when the app under test was built with it, as CI does for both the build and the run: some known defects exist only with the flag, others only without. |",
"| `VITE_ENABLE_GRAPHQL_SOUP` | Set to `true` when the app under test was built with it and with `VITE_ENABLE_CHANNEL_LOCAL_SYNC=true`, as CI does for both the build and the run: some known defects exist only with the flags, others only without. The suite knows two builds, both flags or neither; a build with the first alone keeps no channels on the device and fails the device tests. |");
