/** Meeting URLs contain bearer capabilities; retain the route, never the token. */
export function redactCallLinkTokens(value: string): string {
  return value.replace(
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
  );
}

/** Person-property updates can retain landing URLs after a meeting is closed. */
export function redactCallLinkProperties(
  properties: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(properties).map(([key, value]) => {
      if (typeof value === 'string') {
        return [key, redactCallLinkTokens(value)];
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
                ? redactCallLinkTokens(initialValue)
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
  return redactCallLinkTokens(raw.split(/[?#]/, 1)[0]);
}
