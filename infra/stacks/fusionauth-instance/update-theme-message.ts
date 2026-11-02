import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const [stack, mode, ...extra] = process.argv.slice(2);
if (
  (stack !== 'dev' && stack !== 'prod') ||
  (mode !== undefined && mode !== '--apply') ||
  extra.length > 0
) {
  throw new Error('Usage: bun update-theme-message.ts <dev|prod> [--apply]');
}

const config = (key: string) =>
  execFileSync(
    'pulumi',
    ['config', 'get', `fusionauth:${key}`, '--stack', `macro-inc/${stack}`],
    {
      cwd: fileURLToPath(new URL('.', import.meta.url)),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  ).trim();

// These are the existing theme IDs configured in constants.ts.
const themeId =
  stack === 'prod'
    ? 'e486f9ac-e63f-4549-8244-ee8ed641f8a0'
    : '87cf78dd-03ba-478a-9211-3da0cdba9c3f';
const entry =
  "[IdentityProviderValidationException]=We couldn't complete sign-in. If this Gmail address is connected as an additional inbox, sign in with the email you originally used to create your Macro account. Return to Macro and choose Continue with email, or contact support.";
const url = new URL(`/api/theme/${themeId}`, config('host'));
const headers = { Authorization: config('apiKey') };
const response = await fetch(url, { headers, redirect: 'error' });
if (!response.ok) throw new Error(`Theme read failed: HTTP ${response.status}`);

const messages: string = JSON.parse(await response.text()).theme
  .defaultMessages;
const existingEntry = /^\[IdentityProviderValidationException\]=[^\r\n]*/m;
const updated = existingEntry.test(messages)
  ? messages.replace(existingEntry, entry)
  : `${messages}${messages.endsWith('\n') ? '' : '\n'}${entry}\n`;

console.log(`${stack}: ${entry}`);
if (updated === messages) {
  console.log('Already up to date.');
} else if (mode !== '--apply') {
  console.log(
    'Preview only. Use --apply after authorization to update the theme.'
  );
} else {
  const patch = await fetch(url, {
    method: 'PATCH',
    redirect: 'error',
    headers: { ...headers, 'Content-Type': 'application/json-patch+json' },
    // Reject a stale read rather than overwrite another message edit.
    body: JSON.stringify([
      { op: 'test', path: '/theme/defaultMessages', value: messages },
      { op: 'replace', path: '/theme/defaultMessages', value: updated },
    ]),
  });
  if (!patch.ok) {
    throw new Error(
      `Theme patch failed: HTTP ${patch.status}; preview again before retrying`
    );
  }
  console.log('Theme message updated.');
}
