import { ViewSkeleton } from '@app/components/view-shell/ViewSkeleton';
import { t } from '@app/lib/i18n';
import { Button } from '@ui';
import { Match, Switch } from 'solid-js';
import { AgentRequests } from '../components/agent-requests';
import { createAgentRequests } from '../primitives/agent-requests';
import type { AgentRequestSource } from '../queries/agent-requests';

/** Review of one item's agents, for people who can manage the item. */
export function ItemAgentRequests(props: {
  source: AgentRequestSource;
  itemId: string;
}) {
  const requests = createAgentRequests(props.source, () => props.itemId);
  return (
    <Switch>
      <Match when={requests.pending()}>
        <section
          aria-label={t('passwords.agentAccess')}
          class="border-t border-edge-muted py-3 text-xs text-ink-muted"
        >
          <ViewSkeleton.Rows label={t('passwords.agentAccess')} count={1} />
        </section>
      </Match>
      <Match when={requests.error()}>
        <section
          aria-label={t('passwords.agentAccess')}
          class="flex items-center gap-2 border-t border-edge-muted py-3 text-xs"
        >
          <p role="alert">{t('passwords.failed')}</p>
          <Button
            variant="secondary"
            size="sm"
            disabled={requests.busy()}
            onClick={requests.retry}
          >
            {t('passwords.retry')}
          </Button>
        </section>
      </Match>
      <Match when={!requests.pending() && !requests.error()}>
        <AgentRequests
          states={requests.shown()}
          nameOf={requests.nameOf}
          busy={requests.busy()}
          stale={requests.stale()}
          failed={requests.failed()}
          onResolve={requests.resolve}
          onRevoke={requests.revoke}
        />
      </Match>
    </Switch>
  );
}
