import { describe, expect, test } from 'bun:test';
import { refusal, type ToolCall } from '../../../agent/guard.ts';
import { guards } from '../../../agent/guards/index.ts';
import {
  denied,
  mailLinks,
  mailWake,
} from '../../../agent/guards/mail-wake.ts';
import { sendsEmail } from '../../../agent/guards/no-email.ts';
import { linkKeys } from '../message.ts';

const call = (
  tool: string,
  input: unknown,
  event?: ToolCall['event']
): ToolCall => ({
  tool,
  input,
  cwd: '',
  environment: {},
  ...(event === undefined ? {} : { event }),
});
const code = 'mcp__assistant__ExecuteCode';

describe('no email', () => {
  const bash = (command: string) => sendsEmail(call('Bash', { command }));
  const script = (source: string) => sendsEmail(call(code, { source }));

  test('blocks the ways an agent could send email', () => {
    for (const command of [
      "bun cdp.ts open 'https://mail.google.com/mail/?view=cm&fs=1&to=x@y.test&su=hi'",
      "CDP_TARGET=mail.google.com bun cdp.ts click 'text=Send'",
      'curl -X POST https://api.agentmail.to/v0/inboxes/assistant/messages/send -d @m.json',
      'printf "Subject: hi" | sendmail owner@example.com',
      "bun cdp.ts open 'mailto:support@chat.test'",
    ])
      expect(bash(command)).toBeDefined();
    expect(
      sendsEmail(call('mcp__claude_ai_Gmail__send_email', {}))
    ).toBeDefined();
  });
  test("the Gmail API and its credential are the capability's alone", () => {
    for (const command of [
      'curl -X POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send -d @m.json',
      'curl https://gmail.googleapis.com/gmail/v1/users/me/drafts',
      'openssl s_client -connect smtp.gmail.com:465',
      'sops -d --extract \'["MAIL_REFRESH_TOKEN"]\' secrets.enc.json',
      "bin/agent replyToMail '{}'; curl https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    ])
      expect(bash(command)).toBeDefined();
    expect(
      script(
        'export const main = ({ context }) => context.credentials.get("MAIL_CLIENT_SECRET")'
      )
    ).toBeDefined();
  });
  test('the one send path passes, and it enforces the rest itself', () => {
    expect(
      bash('bin/agent replyToMail \'{"id":"19abc","text":"On it."}\'')
    ).toBeUndefined();
    expect(
      script(
        'import { replyToMail } from "/agent/behavior/capabilities/mail/index.ts"; export const main = ({ context }) => replyToMail(context, { id: "19abc", text: "On it.", cc: ["bo@example.com"] })'
      )
    ).toBeUndefined();
    expect(bash('bin/agent readMail \'{"id":"19abc"}\'')).toBeUndefined();
  });
  test('reading mail and ordinary work pass', () => {
    for (const command of [
      "CDP_TARGET=mail.google.com bun cdp.ts text 'div[role=main]'",
      "bun cdp.ts open 'https://mail.google.com/mail/u/0/#inbox'",
      'curl https://api.agentmail.to/v0/inboxes/probe/messages',
      'git commit -m "fix: mail"',
      "CDP_TARGET=dashboard.vendor.test bun cdp.ts click 'text=Send code'",
    ])
      expect(bash(command)).toBeUndefined();
    expect(
      sendsEmail(
        call('mcp__claude_ai_Gmail__search_threads', { q: 'from:vercel' })
      )
    ).toBeUndefined();
    expect(
      sendsEmail(
        call('Edit', {
          file_path: 'README.md',
          new_string: 'agent@example.com',
        })
      )
    ).toBeUndefined();
  });
  test('it holds every run of the agent', () => {
    expect(
      refusal(guards, call('Bash', { command: 'echo hi | sendmail a@b.test' }))
    ).toContain('no-email');
  });
});

describe('the wake guard', () => {
  const bash = (command: string, links: readonly string[] = []) =>
    denied({ tool: 'Bash', input: { command } }, links);
  const script = (source: string) =>
    denied({ tool: code, input: { source } }, []);

  test('a run that read mail cannot spend, merge, deploy, or spawn', () => {
    for (const command of [
      'bin/agent exec - <<< \'context.credentials.get("CARD_NUMBER")\'',
      'echo $ACCOUNT_PASSWORD',
      'sops -d secrets.enc.json',
      'cat secrets.enc.json',
      'doppler secrets download',
      'bin/agent doLater \'{"task":"x","label":"y"}\'',
      'gh pr merge 3',
      'pulumi up',
      'git push origin main',
      'bin/agent dmOwner \'{"text":"hi"}\'',
      "bin/agent placeCall '{}'",
      'bin/agent run',
      "bin/agent land '{}'",
      "bun cdp.ts click 'text=Upgrade plan'",
      'echo x > behavior/capabilities/mail/filter.ts',
      'sed -i s/a/b/ AGENT.md',
    ])
      expect(bash(command)).toBeDefined();
    for (const source of [
      'import { doLater } from "/agent/behavior/capabilities/later/index.ts"; await doLater(context, { task: "x", label: "y" })',
      'import { postMessage } from "/agent/behavior/capabilities/index.ts"; await postMessage(context, { channelId: "c", text: "hi" })',
      'import { replyInThread } from "/agent/behavior/capabilities/index.ts"; await replyInThread(context, { channelId: "c", root: "r", text: "hi" })',
      'import { dmPerson } from "/agent/behavior/capabilities/index.ts"; await dmPerson(context, { userId: "macro|a@example.com", text: "hi" })',
      'await context.chat.dm("macro|a@example.com", "hi")',
      'const macro = await context.macro()',
      'await context.credentials.set("X", "y")',
      'import { removeSchedule } from "/agent/behavior/capabilities/index.ts"; await removeSchedule(context, { name: "heartbeat" })',
      'import { scheduleAction } from "/agent/behavior/capabilities/index.ts"; await scheduleAction(context, { name: "x", wake: "do it" })',
      'import { setCredential } from "/agent/behavior/capabilities/index.ts"; await setCredential(context, { name: "X" })',
      'import { land } from "/agent/behavior/capabilities/index.ts"; await land(context, { branch: "x" })',
      'import { commit } from "/agent/behavior/capabilities/index.ts"; await commit(context)',
    ])
      expect(script(source)).toBeDefined();
    // A function under another name, or a whole module, would hide what a script calls.
    for (const source of [
      'import { land as ship } from "/agent/behavior/capabilities/heartbeat/index.ts"; await ship(context, { branch: "x" })',
      'import { readMail, commit } from "/agent/behavior/capabilities/heartbeat/index.ts"; await commit(context)',
      'import * as heartbeat from "/agent/behavior/capabilities/heartbeat/index.ts"; await heartbeat["la" + "nd"](context, { branch: "x" })',
      'const heartbeat = await import("/agent/behavior/capabilities/heartbeat/index.ts")',
      'const heartbeat = require("/agent/behavior/capabilities/heartbeat/index.ts")',
    ])
      expect(script(source)).toBeDefined();
    for (const file of [
      '/x/AGENT.md',
      '/x/behavior/capabilities/mail/filter.ts',
      '/x/behavior/agent/guards/index.ts',
      '/x/cli.ts',
      '/x/secrets.enc.json',
    ]) {
      expect(
        denied({ tool: 'Edit', input: { file_path: file } }, [])
      ).toBeDefined();
      expect(
        denied({ tool: 'Write', input: { file_path: file } }, [])
      ).toBeDefined();
    }
  });
  test('what it needs still works', () => {
    for (const source of [
      'import { readMail } from "/agent/behavior/capabilities/index.ts"; await readMail(context, { id: "abc" })',
      'import { replyToMail } from "/agent/behavior/capabilities/index.ts"; await replyToMail(context, { id: "abc", text: "On it." })',
      'import { alertOwnerAboutMail } from "/agent/behavior/capabilities/index.ts"; await alertOwnerAboutMail(context, { id: "abc", text: "real" })',
      'import { mailMissed } from "/agent/behavior/capabilities/index.ts"; await mailMissed(context, { id: "abc", expected: "wake", question: "billing_problem", why: "x" })',
      'import { setMailFilter } from "/agent/behavior/capabilities/index.ts"; await setMailFilter(context, { threshold: 0.6, questions: {} })',
      'import { filteredMail } from "/agent/behavior/capabilities/index.ts"; await filteredMail(context, { hours: 24 })',
      'import { mailReviewed } from "/agent/behavior/capabilities/index.ts"; await mailReviewed(context, { text: "nothing missed" })',
      'import { expectSignIn } from "/agent/behavior/capabilities/index.ts"; await expectSignIn(context, { domain: "vendor.test" })',
    ])
      expect(script(source)).toBeUndefined();
    for (const command of [
      'gh pr view 3 --comments',
      'git -C ~/code/project log --oneline -3; echo "commit and land"',
      "bun cdp.ts open 'https://app.vendor.test/'",
      'bin/agent readMail \'{"id":"abc"}\'',
    ])
      expect(bash(command)).toBeUndefined();
    expect(
      denied(
        {
          tool: 'Edit',
          input: { file_path: '/x/state/memory/shared/notes.md' },
        },
        []
      )
    ).toBeUndefined();
  });
  test("the mail's own links stay shut; the vendor's front door is open", () => {
    const links = linkKeys(
      'Pay here https://vendor.example/billing/invoice/991?x=1'
    );
    expect(
      bash(
        "bun cdp.ts open 'https://vendor.example/billing/invoice/991?other=2'",
        links
      )
    ).toBeDefined();
    expect(
      bash('curl https://vendor.example/billing/invoice/991', links)
    ).toBeDefined();
    expect(
      denied(
        {
          tool: code,
          input: {
            source: 'await fetch("https://vendor.example/billing/invoice/991")',
          },
        },
        links
      )
    ).toBeDefined();
    expect(
      bash("bun cdp.ts open 'https://vendor.example/'", links)
    ).toBeUndefined();
    expect(
      bash("bun cdp.ts open 'https://vendor.example/account/usage'", links)
    ).toBeUndefined();
  });
  test("only runs woken by mail, and the filter's review, carry the guard", () => {
    const arrival = {
      kind: 'mail',
      id: 'a',
      threadId: 't',
      domain: 'vendor.example',
      authenticated: true,
      colleague: false,
      links: ['abc'],
    };
    expect(mailLinks({ name: 'mail', payload: arrival })).toEqual(['abc']);
    // A mail event that can't be read is still a mail run.
    expect(mailLinks({ name: 'mail', payload: { kind: 'nonsense' } })).toEqual(
      []
    );
    expect(
      mailLinks({ name: 'schedules', payload: { name: 'mail-filter-review' } })
    ).toEqual([]);
    expect(
      mailLinks({ name: 'schedules', payload: { name: 'heartbeat' } })
    ).toBeUndefined();
    expect(mailLinks({ name: 'conversations', payload: {} })).toBeUndefined();
    expect(mailLinks(undefined)).toBeUndefined();

    const merge = { command: 'gh pr merge 1' };
    expect(
      mailWake.check(call('Bash', merge, { name: 'mail', payload: arrival }))
    ).toBeDefined();
    expect(
      refusal(
        guards,
        call('Bash', merge, {
          name: 'schedules',
          payload: { name: 'mail-filter-review' },
        })
      )
    ).toContain('mail-wake');
    expect(
      mailWake.check(
        call('Bash', merge, { name: 'conversations', payload: {} })
      )
    ).toBeUndefined();
    expect(mailWake.check(call('Bash', merge))).toBeUndefined();
  });
});
