import { type Env, HOSTS } from '../src/config';

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
const headers: Record<string, string> = {
  'x-macro-bot-token': botToken,
  'x-macro-bot-scope': actAs ? 'user' : 'team',
};
if (actAs) {
  headers['x-macro-bot-for-macro-user-id'] = actAs;
  console.error(`acting as ${actAs} (user scope)`);
} else {
  console.error('no acting user given (team scope)');
}

const res = await fetch(`${HOSTS[env].storage}/documents/${docId}/text`, {
  headers,
});
if (!res.ok) {
  console.error(`${res.status} ${await res.text()}`);
  process.exit(1);
}
const { text } = (await res.json()) as { text: string };
console.log(text);
