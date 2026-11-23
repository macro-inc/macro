/**
 * Meeting URLs and team invite links contain bearer capabilities; retain the
 * route, never the token. Invite links are also matched percent-encoded, as in
 * a login `redirect` parameter. A page whose URL this changes is private: its
 * events are dropped (`isPrivateCallPage`).
 */
export function redactPrivatePageTokens(value: string): string {
  return value
    .replace(
      /(\/call\/(?:meetings\/)?(?:join|invite)\/|\/(?:app\/)?meet\/(?:join\/)?)([^/?#\s"']+)/g,
      (match, prefix: string, token: string) => {
        if (
          (prefix === '/meet/' || prefix === '/app/meet/') &&
          (token === 'new' || token === 'join')
        ) {
          return match;
        }
        return `${prefix}:shareToken`;
      }
    )
    .replace(
      /((?:\/|%2F)team-invite(?:\?|%3F)(?:[^#\s"']*?(?:&|%26))?link(?:=|%3D))[^&%#\s"']+/gi,
      '$1:inviteToken'
    );
}

/**
 * Everything `redactPrivatePageTokens` hides, plus sign-in session codes: the
 * `/session/login/{code}` request and the `?token=` an SSO return carries
 * (in the hash on native, which routes by hash). Those pages still report
 * events, such as the signup conversion, with the code removed.
 */
export function redactLinkTokens(value: string): string {
  return redactPrivatePageTokens(value)
    .replace(/(\/session\/login\/)[^/?#\s"']+/g, '$1:sessionCode')
    .replace(/((?:[?&]|%3F|%26)token(?:=|%3D))[^&%#\s"']+/gi, '$1:sessionCode');
}

/** Person-property updates can retain landing URLs after the page is closed. */
export function redactLinkTokenProperties(
  properties: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, redactLinkTokens(value)];
      }
      if (
        (key === '$set' || key === '$set_once') &&
        value !== null &&
        typeof value === 'object' &&
        !Array.isArray(value)
      ) {
        return [
          key,
          Object.fromEntries(
            Object.entries(value).map(([property, initialValue]) => [
              property,
              typeof initialValue === 'string'
                ? redactLinkTokens(initialValue)
                : initialValue,
            ])
          ),
        ];
      }
      return [key, value];
    })
  );
}

/** Keep fetch diagnostics useful without recording query or path credentials. */
export function telemetryUrl(input: RequestInfo): string {
  const raw = typeof input === 'string' ? input : input.url;
  return redactLinkTokens(raw.split(/[?#]/, 1)[0]);
}
