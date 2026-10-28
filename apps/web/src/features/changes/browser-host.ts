import { toast } from '@core/component/Toast/Toast';
import { openExternalUrl } from '@core/util/url';
import type { ChangesHost } from './context/changes-context';

/** Browser actions shared by production hosts, never implicit controller defaults. */
export function createBrowserChangesActions(): Pick<
  ChangesHost,
  'copyText' | 'openExternal' | 'notify'
> {
  return {
    openExternal: openExternalUrl,
    copyText: async (text) => {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        return false;
      }
    },
    notify: (message, tone) => {
      if (tone === 'success') toast.success(message);
      else toast.failure(message);
    },
  };
}
