import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  FUSIONAUTH_THEME_IDS,
  patchSignInMessage,
  SIGN_IN_ERROR_MESSAGE,
} from './theme-message';

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

const result = await patchSignInMessage(
  config('host'),
  config('apiKey'),
  FUSIONAUTH_THEME_IDS[stack],
  mode === '--apply'
);
console.log(`${stack}: ${result} [IdentityProviderValidationException]`);
console.log(SIGN_IN_ERROR_MESSAGE);
if (result === 'preview') {
  console.log(
    'No changes made. Applying requires an explicitly authorized --apply run.'
  );
}
