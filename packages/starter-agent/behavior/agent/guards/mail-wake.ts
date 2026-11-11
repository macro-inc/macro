import { mailSource, reviewSchedule } from '../../capabilities/mail/config.ts';
import { linkKey, linksIn } from '../../capabilities/mail/message.ts';
import { Arrival } from '../../capabilities/mail/watch.ts';
import type { Guard, ToolCall } from '../guard.ts';

/**
 * Holds a run woken by mail to less than any other. A run that read an
 * untrusted email can be talked into things, so nothing here can spend,
 * merge, deploy, push, hand itself more work, post in chat, call anyone, change a
 * secret or a schedule, or rewrite the charter or the code, and the mail's
 * own links stay shut. It's a seatbelt, not a sandbox: it reads tool
 * input for known shapes, and the wake request carries the same rules.
 */

const schedulesSource = 'schedules';

/**
 * The hashes of the links this run must not follow, if it was woken by mail
 * or is the daily review of the filter; undefined for any other run.
 */
export const mailLinks = (
  event: ToolCall['event']
): readonly string[] | undefined => {
  if (event === undefined) return undefined;
  if (event.name === mailSource) {
    const arrival = Arrival.safeParse(event.payload);
    // A mail event that can't be read is still a mail run.
    return arrival.success ? arrival.data.links : [];
  }
  if (
    event.name === schedulesSource &&
    typeof event.payload === 'object' &&
    event.payload !== null &&
    'name' in event.payload &&
    event.payload.name === reviewSchedule
  )
    return [];
  return undefined;
};

/**
 * A function with a common word for a name, as a script or a shell calls it.
 * A script can only call one it has imported by name, since anything that
 * imports a whole module is refused below.
 */
const called = (names: string): string =>
  `\\bimport\\b[^;]*\\{[^}]*\\b(${names})\\b[^}]*\\}|\\bbin\\/agent\\s+(${names})\\b`;

const commands: readonly (readonly [RegExp, string])[] = [
  [
    /CARD|ACCOUNT_(PASSWORD|TOTP|BACKUP)|MAIL_/,
    'card, account password, and mail credentials are off limits here',
  ],
  [
    /\bcredentials\s*\.\s*set\b|\bsetCredential\b|\bsops\b|secrets\.enc\.json|\bdoppler\b/,
    'no secret changes, and no reading the secrets file',
  ],
  [
    new RegExp(
      `\\bdoLater\\b|${called('land|commit')}|\\bpr\\s+merge\\b|\\bpulumi\\s+(up|destroy|import)\\b|\\bgit\\s+push\\b|\\bbin\\/agent\\s+run\\b`
    ),
    'no merging, deploying, pushing, or handing yourself more work from a mail',
  ],
  [
    // A whole module under another name would hide which of its functions a script calls.
    /\bimport\s*\*|\bimport\s*\(|\brequire\s*\(/,
    'a mail run imports the functions it calls by name: no `import *`, `import()` or `require`',
  ],
  [
    /\b(set|remove|pause|resume)Schedule\b|\bscheduleAction\b/,
    'no schedule changes from a mail run',
  ],
  [
    /\b(postMessage|replyInThread|dmOwner|dmPerson|placeCall|askOntoCall)\b|\bchat\s*\.\s*(send|dm|reply)\b|\.macro\s*\(/,
    'no chat or calls from a mail run: alertOwnerAboutMail is the rate-limited way to your owner',
  ],
  [
    /\bpurgePerson\b/,
    'no new accounts, and no forgetting people, from a mail run',
  ],
  [
    /\bclick\b[^\n]*\b(buy|upgrade|pay|purchase|subscribe|checkout|confirm|delete|cancel|remove|change plan|top.?up)\b/i,
    'no money or account-changing clicks from a mail run',
  ],
];

/** The charter, the code, and what configures them. The filter is changed with setMailFilter, which holds it to its rules. */
const protectedFile =
  /(^|\/)(AGENT\.md|ARCHITECTURE\.md|CLAUDE\.md|behavior\/|src\/|bin\/|\.claude\/|secrets\.enc\.json|\.sops\.yaml|flake\.nix|package\.json|(index|cli)\.ts$)/;
const shellWrite =
  /(>>?\s*|\btee\s+(-a\s+)?|\bsed\s+-i\S*\s+[^\n]*?|\b(cp|mv|rm)\s+[^\n]*?)\S*(AGENT\.md|ARCHITECTURE\.md|CLAUDE\.md|behavior\/|\.claude\/|secrets\.enc\.json|\.sops\.yaml)/;
const edits = /^(Edit|Write|MultiEdit|NotebookEdit)$/;

const fileOf = (input: unknown): string => {
  if (typeof input !== 'object' || input === null) return '';
  if ('file_path' in input && typeof input.file_path === 'string')
    return input.file_path;
  if ('notebook_path' in input && typeof input.notebook_path === 'string')
    return input.notebook_path;
  return '';
};

/** Why a run that read mail may not make this call, or undefined. `links` are the hashes of the mail's own links. */
export const denied = (
  { tool, input }: Pick<ToolCall, 'tool' | 'input'>,
  links: readonly string[]
): string | undefined => {
  const file = fileOf(input);
  if (file !== '' && edits.test(tool) && protectedFile.test(file))
    return `a mail run doesn't edit ${file}`;
  const text = JSON.stringify(input ?? {});
  if (shellWrite.test(text))
    return "a mail run doesn't rewrite the charter or the code";
  const refused = commands.find(([shape]) => shape.test(text));
  if (refused !== undefined) return refused[1];
  // Link matching is by hash of host and path, so a vendor's front page still opens.
  const followed = linksIn(text.replace(/\\"/g, '"')).some((url) => {
    const key = linkKey(url);
    return key !== undefined && links.includes(key);
  });
  return followed
    ? "that link came from the mail: reach the vendor on your own (its front page or API), never through the mail's link"
    : undefined;
};

export const mailWake: Guard = {
  name: 'mail-wake',
  check: (call) => {
    const links = mailLinks(call.event);
    return links === undefined ? undefined : denied(call, links);
  },
};
