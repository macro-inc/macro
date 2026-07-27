/**
 * Dump a document's raw content using a bot API key — exercises the
 * bot-accessible document routes that are live upstream today.
 *
 * Usage:
 *   MACRO_BOT_TOKEN=mbot_... bun examples/doc-dump.ts <doc-id-or-url> [acting-user-id]
 *
 * The doc can be a raw id or a https://macro.com/app/md/<id> URL. With an
 * acting user (e.g. 'macro|wolf@macro.com' — the bot's owner or a member of
 * its owning team) the bot reads with that user's access; without one it uses
 * the owning team's access. Set MACRO_ENV to 'dev' (default) / 'prod' / 'local'.
 */
import type { Env } from '../src/config';
import { Macro } from '../src/macro';

const [docArg, actAs] = process.argv.slice(2);
const botToken = process.env.MACRO_BOT_TOKEN;
if (!docArg || !botToken) {
  console.error(
    'usage: MACRO_BOT_TOKEN=mbot_... bun examples/doc-dump.ts <doc-id-or-url> [acting-user-id]',
  );
  process.exit(1);
}
const docId = docArg.startsWith('http')
  ? (new URL(docArg).pathname.split('/').filter(Boolean).pop() ?? docArg)
  : docArg;

const env = (process.env.MACRO_ENV ?? 'dev') as Env;
let macro = new Macro({ env, auth: { type: 'bot', token: botToken } });
if (actAs) {
  macro = macro.requestedAs(actAs);
  console.error(`acting as ${actAs} (user scope)`);
} else {
  console.error('no acting user given (team scope)');
}

const doc = macro.documents.byId(docId);
console.log(await doc.content());
