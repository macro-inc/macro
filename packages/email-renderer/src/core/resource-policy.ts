/** Explicit policy: preparation never reads an origin, flag, or network client. */
export interface ImagePolicy {
  remote: 'allow' | 'block';
  /** Proxy for img[src], matching native authenticated-image support.
   * CSS/background images retain direct URLs under the remote policy. */
  proxyUrl?: string;
}

function cleanUrl(value: string): string {
  const url = Array.from(value)
    .filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f)
    .join('')
    .trim();
  return url.startsWith('//') ? `https:${url}` : url;
}

const hasScheme = (url: string) => /^[a-z][a-z\d+.-]*:/i.test(url);

/** Relative resources remain literal; only the browser resolves their base URL. */
export function imageUrl(
  value: string,
  policy: ImagePolicy
): string | undefined {
  const url = cleanUrl(value);
  if (/^cid:/i.test(url)) return `cid:${url.slice(4)}`;
  if (
    /^data:image\/(?:png|gif|jpe?g|webp|avif|bmp);base64,[a-z0-9+/=]+$/i.test(
      url
    )
  )
    return url;
  if (policy.remote === 'block') return;
  if (!hasScheme(url)) return url;
  if (!/^https?:\/\//i.test(url)) return;
  if (!policy.proxyUrl)
    return url.replace(/^https?:/i, (scheme) => scheme.toLowerCase());
  if (!/^https?:\/\//i.test(policy.proxyUrl)) return;
  return `${policy.proxyUrl}${policy.proxyUrl.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}`;
}

export function linkUrl(value: string): string | undefined {
  const url = cleanUrl(value);
  if (/^(?:https?:\/\/|mailto:|tel:|sms:|cid:)/i.test(url) || !hasScheme(url))
    return url;
}
