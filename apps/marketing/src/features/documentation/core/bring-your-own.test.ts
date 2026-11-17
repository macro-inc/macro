import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

// The page the Macro agent reads to answer how to run Claude Code or Codex
// through macrod. A cached copy of an older version once taught it a webhook
// setup that no longer exists.
const page = readFileSync(
  path.resolve(
    import.meta.dirname,
    '../../../../../docs/AI/bring-your-own.mdx'
  ),
  'utf8'
);

it('gives the current macrod setup steps', () => {
  for (const step of [
    'crates/coding_agent_worker/install/install.sh',
    '**Quickstart**',
    '**Claude Code in herdr**',
    '**Create and pair**',
    '**Settings → Machines → New machine**',
    '**Look up**',
    '**Approve**',
    '**Settings → Agents → Add agent**',
    'choose **On your machine**',
    '## Run agents on a cloud server',
    'needs no public address, open port, reverse proxy, or tunnel',
  ]) {
    expect(page).toContain(step);
  }
});

it('never teaches the retired webhook setup', () => {
  for (const retired of [
    'macro-events',
    '8790',
    'bot_token',
    'public_url',
    'available soon',
    'Settings → Bots',
    'npx -y @agentclientprotocol',
    'In your harness',
  ]) {
    expect(page).not.toContain(retired);
  }
});
