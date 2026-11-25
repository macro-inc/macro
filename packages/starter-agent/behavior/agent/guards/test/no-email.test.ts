import { expect, test } from 'bun:test';
import { refusal } from '../../guard.ts';
import { guards } from '../index.ts';
import { noEmailReason, sendsEmail } from '../no-email.ts';

const script = 'mcp__capabilities__RunCapabilityScript';
const call = (tool: string, input: unknown) =>
  sendsEmail({ tool, input, cwd: '/agent', environment: {} });
const bash = (command: string) => call('Bash', { command });
const run = (source: string) => call(script, { source });

test('connected mail still never sends: Gmail, mail programs, mail tools', () => {
  for (const refused of [
    bash(
      'curl -X POST https://gmail.googleapis.com/gmail/v1/users/me/messages/send'
    ),
    bash('echo hi | sendmail person@example.org'),
    bash('open "mailto:person@example.org"'),
    call('mcp__gmail__send_email', { to: 'person@example.org' }),
    call('mcp__mail__reply_to_thread', { id: 'x' }),
  ])
    expect(refused).toBe(noEmailReason);
});

test("the agent's own mailbox sends only through its capability", () => {
  for (const refused of [
    run(
      'export async function main({ context }) {\n  const macro = await context.macro();\n  return macro.agentMailbox.send({ to: ["a@example.org"], subject: "x", textBody: "x", userConfirmation: "yes" });\n}'
    ),
    run(
      'import { AgentMailMessage } from "@macro-inc/sdk";\nexport async function main({ context }) {\n  const macro = await context.macro();\n  return AgentMailMessage.byId(macro._client, "in-1").reply({ textBody: "x", userConfirmation: "ok" });\n}'
    ),
    run(
      'export async function main({ context }) {\n  const page = await (await context.macro()).agentMailbox.messages();\n  return page.messages[0]?.reply({ textBody: "x", userConfirmation: "ok" });\n}'
    ),
    run(
      'export async function main({ context }) { return (await context.macro())._client.email.sendAgentMailboxMessage({ body: {} }); }'
    ),
    bash(
      'curl -X POST http://127.0.0.1:4000/email/email/agent-mailbox/messages -d @mail.json'
    ),
  ])
    expect(refused).toBe(noEmailReason);
  expect(noEmailReason).toContain('sendMyEmail');
});

test("the mailbox capability, and reading the agent's own mail, go through", () => {
  for (const allowed of [
    bash('bin/agent myEmailAddress'),
    bash('bin/agent listMyEmail \'{"limit":5}\''),
    bash(
      'bin/agent sendMyEmail \'{"draftId":"00000000-0000-4000-8000-00000000000a","approvalMessageId":"m-2"}\''
    ),
    run(
      'import { draftMyReply, replyToMyEmail } from "/agent/behavior/capabilities/mailbox/index.ts";\nexport async function main({ context }) {\n  return replyToMyEmail(context, { draftId: "00000000-0000-4000-8000-00000000000a", approvalMessageId: "m-2" });\n}'
    ),
    run(
      'import { readMyEmail } from "/agent/behavior/capabilities/mailbox/index.ts";\nexport async function main({ context }) { return readMyEmail(context, { messageId: "in-1" }); }'
    ),
  ])
    expect(allowed).toBeUndefined();
});

test('the no-email guard is one of the guards every call meets', () => {
  expect(
    refusal(guards, {
      tool: script,
      input: { source: 'await (await context.macro()).agentMailbox.send({})' },
      cwd: '/agent',
      environment: {},
    })
  ).toBe(`no-email: ${noEmailReason}`);
});
