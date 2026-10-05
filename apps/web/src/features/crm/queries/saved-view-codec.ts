import { type CrmViewConfig, isCrmViewConfig } from '../core/saved-view';
export const CRM_VIEW_URL_PARAM = 'crmView';

/** Base64url-encode a view config for the share link. */
export function encodeCrmViewParam(config: CrmViewConfig): string {
  const json = JSON.stringify(config);
  const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
  return base64.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function decodeCrmViewParam(param: string): CrmViewConfig | undefined {
  try {
    const base64 = param.replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    return isCrmViewConfig(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}
