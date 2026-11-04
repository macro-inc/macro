import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { assignOauthUrl, reserveOauthPopup } from '@core/pipedream/oauth-popup';
import { Telemetry } from '@macro-inc/observability';
import {
  useCompleteDialpadMutation,
  useConnectDialpadMutation,
  useDialpadConnectionQuery,
  useDisconnectDialpadMutation,
} from '@queries/dialpad';
import { queryReadyGate } from '@queries/gate';
import type { DialpadBackfill } from '@service-cognition/generated/schemas/dialpadBackfill';
import { type Accessor, createEffect, onCleanup } from 'solid-js';

/** How often to finish setup while the user approves Dialpad elsewhere. */
const COMPLETE_EVERY_MS = 4000;

/**
 * The user's Dialpad call sync. Connecting opens Macro Connect, where the
 * user approves Dialpad; while that is pending this finishes setup on an
 * interval, so the row flips to connected without waiting for the backend's
 * next pass. `connection` is undefined until loaded.
 */
export function createDialpadConnection(enabled: Accessor<boolean>) {
  const query = useDialpadConnectionQuery(enabled);
  const connectMutation = useConnectDialpadMutation();
  const completeMutation = useCompleteDialpadMutation();
  const disconnectMutation = useDisconnectDialpadMutation();

  const connection = () => (queryReadyGate(query) ? query.data : undefined);

  createEffect(() => {
    if (!enabled() || connection()?.state !== 'connecting') return;
    const timer = setInterval(() => {
      if (!completeMutation.isPending) completeMutation.mutate();
    }, COMPLETE_EVERY_MS);
    onCleanup(() => clearInterval(timer));
  });

  /** Call from the click itself, so the Macro Connect tab is not blocked. */
  const connect = (backfill: DialpadBackfill) => {
    const popup = reserveOauthPopup();
    return Telemetry.span('dialpad.connect', async (span) => {
      span.setAttr('dialpad.backfill', backfill);
      try {
        const url = await span.run(() => connectMutation.mutateAsync(backfill));
        assignOauthUrl(popup, url);
        span.setAttr('dialpad.outcome', 'started');
      } catch {
        span.setAttr('dialpad.outcome', 'failed');
        popup?.close();
        toast.failure(t('dialpad.connectFailed'));
      }
    });
  };

  const disconnect = async () => {
    try {
      await disconnectMutation.mutateAsync();
    } catch {
      toast.failure(t('dialpad.disconnectFailed'));
    }
  };

  return {
    connection,
    connect,
    connecting: () => connectMutation.isPending,
    disconnect,
    disconnecting: () => disconnectMutation.isPending,
  };
}
