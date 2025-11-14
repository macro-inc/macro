export type UrlResolver = string | (() => string | Promise<string>);

export function isThunk(url: UrlResolver): url is (() => string) | (() => Promise<string>) {
  return typeof url === 'function';
}

export function isString(url: UrlResolver): url is string {
  return typeof url === 'string';
}

export async function resolveUrl(url: UrlResolver): Promise<string> {
  if (isThunk(url)) {
    return await url();
  }
  return url as string;
}
