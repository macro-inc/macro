/** Explicit policy: preparation never reads an origin, flag, or network client. */
export interface ImagePolicy {
  remote: 'allow' | 'block';
  /** Proxy for img[src], matching native authenticated-image support.
   * CSS/background images retain direct URLs under the remote policy. */
  proxyUrl?: string;
}

function cleanUrl(value: string): string {
  return Array.from(value)
    .filter((char) => char.charCodeAt(0) >= 0x20 && char.charCodeAt(0) !== 0x7f)
    .join('')
    .trim();
}

/** Relative images depend on the embedding app's origin, so are excluded. */
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
  if (policy.remote === 'block' || !/^https?:\/\//i.test(url)) return;
  if (!policy.proxyUrl)
    return url.replace(/^https?:/i, (scheme) => scheme.toLowerCase());
  if (!/^https?:\/\//i.test(policy.proxyUrl)) return;
  return `${policy.proxyUrl}${policy.proxyUrl.includes('?') ? '&' : '?'}url=${encodeURIComponent(url)}`;
}

export function linkUrl(value: string): string | undefined {
  const url = cleanUrl(value);
  if (/^(?:https?:\/\/|mailto:|tel:|sms:|#)/i.test(url)) return url;
}
