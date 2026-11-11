// The prompts each tier's turn starts with. Pure: persona text and facts in,
// prompt text out. OPERATING.md is the system prompt for every tier.
import type { Entry } from './history.ts';
export type InFlight = {
  conversation: string;
  taskId: string;
  label: string;
  startedAt: string;
};
const section = (title: string, body: string) =>
  `## ${title}\n\n${body.trim()}\n`;
const jsonLines = (items: unknown[]) =>
  items.length === 0
    ? '(none)'
    : items.map((item) => JSON.stringify(item)).join('\n');
/** How a turn talks in Macro and reaches the brain: through the `brain` binary. */
export function talkCommands(
  exe: string,
  tier: 'respond' | 'heartbeat' | 'work'
): string {
  const lines = [
    '- Full Macro SDK: use ExecuteCode as your own account, within your permissions, charter and budget. First discover the task with DescribeCodeTools, then read its symbols with ReadCodeDocs. The server owns tool descriptions and SDK documentation; never guess methods or seek credentials.',
    `- Post top level (DMs): \`${exe} post <channel_id> -\`, text on stdin.`,
    `- Reply in a thread: \`${exe} reply <channel_id> <root_id> -\`, text on stdin.`,
    `- React instead of posting an acknowledgment: \`${exe} react <channel_id> <message_id> <emoji>\`.`,
    `- Read a conversation: \`${exe} context <channel_id> [root_id]\`.`,
    `- Memory: \`${exe} remember <topic> -\`, \`${exe} recall <words>\`, \`${exe} forget <topic>\`.`,
    `- Your state: \`${exe} focus -\` (what you're on now), \`${exe} promise <to> -\` (a commitment), \`${exe} release <words>\` (a commitment kept or dropped).`,
    `- Wake yourself later: \`${exe} schedule --once <RFC 3339 time> -\` or \`${exe} schedule --cron "<sec min hour dom month dow>" --timezone <tz> -\`, the note on stdin; \`${exe} schedules\` lists them, \`${exe} unschedule <routine_id>\` removes one.`,
  ];
  if (tier === 'respond') {
    lines.push(
      `- Hand off anything longer than a quick lookup: \`${exe} handoff --channel <channel_id> [--root <root_id>] --label "<few words>" -\`, the task on stdin. It becomes a Macro task and a work run that reports back in this conversation.`
    );
  }
  return lines.join('\n');
}
export function respondPrompt(input: {
  instructions: string;
  talk: string;
  batch: Entry[];
  history: Entry[];
  inFlight: InFlight[];
}): string {
  return [
    input.instructions.trim(),
    section('How to talk in Macro', input.talk),
    section('Messages to consider', jsonLines(input.batch)),
    section('Recent history in this conversation', jsonLines(input.history)),
    section('Your work in flight', jsonLines(input.inFlight)),
  ].join('\n');
}
export function heartbeatPrompt(input: {
  instructions: string;
  talk: string;
  reason: string;
  snapshot: string;
  now: Date;
}): string {
  return [
    input.instructions.trim(),
    section('How to talk in Macro', input.talk),
    section('Why you woke', input.reason),
    section('Now', input.now.toISOString()),
    section('Snapshot', input.snapshot),
  ].join('\n');
}
export function workPrompt(input: {
  instructions: string;
  talk: string;
  task: string;
  taskUrl: string;
  conversation: {
    channel: string;
    root: string | null;
  };
}): string {
  const where = input.conversation.root
    ? `channel ${input.conversation.channel}, thread ${input.conversation.root}`
    : `direct message ${input.conversation.channel}`;
  return [
    input.instructions.trim(),
    section('How to talk in Macro', input.talk),
    section('The task', `${input.task}\n\nMacro task: ${input.taskUrl}`),
    section(
      'Where it came from',
      `${where}. Messages that arrive there while you work are added to this run. Your final message is posted there as your report, so make it the report, in your own voice.`
    ),
  ].join('\n');
}
/** A follow-up injected into a running work run. */
export function followUp(entries: Entry[]): string {
  return section('New messages in your conversation', jsonLines(entries));
}
