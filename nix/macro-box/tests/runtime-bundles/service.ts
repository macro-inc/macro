import { appendFileSync, mkdirSync, readFileSync, watch, writeFileSync } from 'node:fs';
import { hostedMaintenance, maintenance } from './node_modules/@macro-inc/muppet/core/maintenance.ts';
import { reportRuntimeReady } from '/fixture/runtime-maintenance.ts';
const root = '/home/macro/.fixture';
const selection = process.env.MACRO_AGENT_RUNTIME_ID ?? 'image';
const invocation = process.env.INVOCATION_ID!;
const head = process.env.MACRO_AGENT_RUNTIME_REVISION!;
const log = (text: string) => appendFileSync(`${root}/log`, `${text}\n`);
log(`started ${selection} invocation ${invocation}`);
const control = hostedMaintenance() ?? maintenance();
const oldBehavior = await Bun.file(`${root}/old-behavior`).exists();
control.eligible(!oldBehavior);
const events = `${root}/events`;
const done = new Set(readFileSync(`${root}/done`, 'utf8').split('\n'));
async function deliver() {
  for (const event of readFileSync(events, 'utf8').split('\n').filter(Boolean)) {
    if (done.has(event)) continue;
    await control.dispatch(false, async () => {
      if (done.has(event)) return;
      log(`delivering ${event} on ${selection}`);
      while (event === 'busy' && !Bun.file(`${root}/release`).size) await Bun.sleep(30);
      if (event === 'busy') {
        const repository = '/home/macro/agent/workspace';
        mkdirSync(`${repository}/state`, { recursive: true });
        writeFileSync(`${repository}/state/advance`, 'admitted work completed');
        for (const args of [['add', 'state'], ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.com', 'commit', '-qm', 'memory checkpoint']]) {
          if (Bun.spawnSync(['git', '-C', repository, ...args]).exitCode !== 0) throw new Error('fixture commit failed');
        }
      }
      done.add(event);
      appendFileSync(`${root}/done`, `${event}\n`);
    });
  }
}
watch(events, () => { void deliver(); });
if (!selection.startsWith('bbbb')) {
  writeFileSync('/home/macro/agent/state/last-good', head);
  if (!oldBehavior) await reportRuntimeReady();
}
void deliver();
