/**
 * Smoke-test a bot API key against the dev environment.
 *
 * Usage:
 *   MACRO_BOT_TOKEN=mbot_... bun examples/bot-smoke.ts [macro-user-id]
 *
 * With a user id, requests act on behalf of that user (the bot's owner, or a
 * member of the bot's owning team). Without one, requests use team scope.
 */
import { Macro } from '../src/macro';

const actAs = process.argv[2];

let macro = new Macro({ env: 'dev' }); // auth from MACRO_BOT_TOKEN
if (actAs) {
  macro = macro.requestedAs(actAs);
  console.log(`acting as ${actAs}`);
}

let count = 0;
for await (const doc of macro.documents.recent()) {
  console.log('-', await doc.name(), doc.webUrl());
  if (++count >= 5) break;
}
console.log(
  count > 0 ? 'bot key works ✔' : 'authenticated, but no documents visible',
);
