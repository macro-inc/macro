import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FUSIONAUTH_THEME_IDS } from './theme-ids';

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

const entry =
  "[IdentityProviderValidationException]=We couldn't complete sign-in. If this Gmail address is connected as an additional inbox, sign in with the email you originally used to create your Macro account. Return to Macro and choose Continue with email, or contact support.";
// FusionAuth's built-in theme, the source of every key a theme must define.
const DEFAULT_THEME_ID = '75a068fd-e94b-451a-9aeb-3ddb9a3b5987';
const host = config('host');
const url = new URL(`/api/theme/${FUSIONAUTH_THEME_IDS[stack]}`, host);
const headers = { Authorization: config('apiKey') };
type Theme = {
  defaultMessages: string;
  templates?: Record<string, string | null>;
};
const readTheme = async (themeUrl: URL): Promise<Theme> => {
  const response = await fetch(themeUrl, { headers, redirect: 'error' });
  if (!response.ok) {
    throw new Error(`Theme read failed: HTTP ${response.status}`);
  }
  return JSON.parse(await response.text()).theme;
};

// A Java properties key ends at the first unescaped `=`, `:` or whitespace.
const messageKey = (line: string) => {
  const trimmed = line.trimStart();
  if (trimmed === '' || trimmed.startsWith('#') || trimmed.startsWith('!')) {
    return undefined;
  }
  let key = '';
  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (char === '\\' && index + 1 < trimmed.length) {
      index += 1;
      key += trimmed[index];
    } else if (char === '=' || char === ':' || /\s/.test(char)) {
      break;
    } else {
      key += char;
    }
  }
  return key === '' ? undefined : key;
};

const theme = await readTheme(url);
const defaultTheme = await readTheme(
  new URL(`/api/theme/${DEFAULT_THEME_ID}`, host)
);
const messages = theme.defaultMessages;
const defaults = defaultTheme.defaultMessages;
if (/\\\r?$/m.test(defaults)) {
  throw new Error('Default theme has multi-line messages; fill keys by hand');
}

// FusionAuth rejects any save of a bundle that lacks a key its version
// requires, so a theme copied before an upgrade needs them added first.
const present = new Set(messages.split(/\r?\n/).map(messageKey));
const missing = defaults.split(/\r?\n/).filter((line) => {
  const key = messageKey(line);
  return key !== undefined && !present.has(key);
});
const withEnd = (text: string) => (text.endsWith('\n') ? text : `${text}\n`);
const filled =
  missing.length === 0
    ? messages
    : `${withEnd(messages)}${missing.join('\n')}\n`;

// The same check covers page templates: add the ones the theme lacks, unchanged
// from the built-in theme, which is what FusionAuth already serves for them.
const missingTemplates = Object.entries(defaultTheme.templates ?? {}).filter(
  ([name, template]) => template && !theme.templates?.[name]?.trim()
);

const existingEntry = /^\[IdentityProviderValidationException\]=[^\r\n]*/m;
const updated = existingEntry.test(filled)
  ? filled.replace(existingEntry, entry)
  : `${withEnd(filled)}${entry}\n`;

console.log(`${stack}: ${entry}`);
if (missing.length > 0) {
  console.log(
    `${stack}: adding ${missing.length} keys the theme lacks, with FusionAuth's default text: ${missing.map(messageKey).join(', ')}`
  );
}
if (missingTemplates.length > 0) {
  console.log(
    `${stack}: adding ${missingTemplates.length} page templates the theme lacks, from FusionAuth's default theme: ${missingTemplates.map(([name]) => name).join(', ')}`
  );
}
if (updated === messages && missingTemplates.length === 0) {
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
      ...missingTemplates.map(([name, template]) => ({
        op: 'add',
        path: `/theme/templates/${name}`,
        value: template,
      })),
    ]),
  });
  if (!patch.ok) {
    throw new Error(
      `Theme patch failed: HTTP ${patch.status}; preview again before retrying`
    );
  }
  console.log('Theme message updated.');
}
