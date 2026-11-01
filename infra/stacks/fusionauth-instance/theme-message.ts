export const FUSIONAUTH_THEME_IDS = {
  prod: 'e486f9ac-e63f-4549-8244-ee8ed641f8a0',
  dev: '87cf78dd-03ba-478a-9211-3da0cdba9c3f',
};

const MESSAGE_KEY = '[IdentityProviderValidationException]';
export const SIGN_IN_ERROR_MESSAGE =
  "We couldn't complete sign-in. If this Gmail address is connected as an additional inbox, sign in with the email you originally used to create your Macro account. Return to Macro and choose Continue with email, or contact support.";

// Only this single-line property is managed; preserve the rest byte for byte.
export function updateSignInMessage(messages: string): string {
  const lines = messages.split(/\r?\n/);
  const matches = lines.flatMap((line, index) =>
    line.includes('IdentityProviderValidationException') ? [index] : []
  );
  const entry = `${MESSAGE_KEY}=${SIGN_IN_ERROR_MESSAGE}`;
  const continues = (line: string) => /(?<!\\)(?:\\\\)*\\$/.test(line);
  if (matches.length === 0) {
    if (continues(lines.at(-1) ?? '') || continues(lines.at(-2) ?? '')) {
      throw new Error('Refusing to append after a continued properties line');
    }
    return `${messages}${messages.endsWith('\n') ? '' : '\n'}${entry}\n`;
  }
  const index = matches[0];
  if (
    matches.length !== 1 ||
    !/^[ \t]*\\?\[IdentityProviderValidationException\\?\][ \t]*[=:]/.test(
      lines[index]
    ) ||
    continues(lines[index]) ||
    (index > 0 && continues(lines[index - 1]))
  ) {
    throw new Error('Refusing to replace an ambiguous or continued message');
  }
  return messages.replace(lines[index], entry);
}

function readTheme(body: unknown) {
  if (!body || typeof body !== 'object' || !('theme' in body)) {
    throw new Error('Expected a theme response');
  }
  const theme = body.theme;
  if (
    !theme ||
    typeof theme !== 'object' ||
    !('type' in theme) ||
    theme.type !== 'advanced' ||
    !('defaultMessages' in theme) ||
    typeof theme.defaultMessages !== 'string'
  ) {
    throw new Error('Expected an advanced theme with defaultMessages');
  }
  return {
    defaultMessages: theme.defaultMessages,
    localizedMessages:
      'localizedMessages' in theme ? theme.localizedMessages : undefined,
  };
}

export async function patchSignInMessage(
  host: string,
  apiKey: string,
  themeId: string,
  apply: boolean
): Promise<'unchanged' | 'preview' | 'updated'> {
  const url = new URL(`/api/theme/${themeId}`, host);
  const headers = { Authorization: apiKey };
  const response = await fetch(url, { headers, redirect: 'error' });
  if (!response.ok) {
    throw new Error(`Theme read failed: HTTP ${response.status}`);
  }
  const theme = readTheme(await response.json());
  if (
    theme.localizedMessages &&
    typeof theme.localizedMessages === 'object' &&
    Object.values(theme.localizedMessages).some(
      (messages) =>
        typeof messages === 'string' &&
        messages.includes('IdentityProviderValidationException')
    )
  ) {
    throw new Error(
      'A localized override needs review before updating this key'
    );
  }
  const updated = updateSignInMessage(theme.defaultMessages);
  if (updated === theme.defaultMessages) return 'unchanged';
  if (!apply) return 'preview';

  // JSON Patch tests the read value before replacing it, rejecting stale edits.
  // No other theme fields, tenant settings, or authentication resources are sent.
  const patch = await fetch(url, {
    method: 'PATCH',
    redirect: 'error',
    headers: { ...headers, 'Content-Type': 'application/json-patch+json' },
    body: JSON.stringify([
      {
        op: 'test',
        path: '/theme/defaultMessages',
        value: theme.defaultMessages,
      },
      { op: 'replace', path: '/theme/defaultMessages', value: updated },
    ]),
  });
  if (!patch.ok) {
    throw new Error(
      `Theme patch failed: HTTP ${patch.status}; read again before retrying`
    );
  }
  const result = readTheme(await patch.json());
  if (result.defaultMessages !== updated) {
    throw new Error('Theme response did not confirm the updated messages');
  }
  return 'updated';
}
