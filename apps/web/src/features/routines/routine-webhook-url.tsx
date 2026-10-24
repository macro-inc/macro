import { scheduledActionWebhookEndpoint } from '@core/constant/servers';
import { fireAndForget } from '@core/util/fireAndForget';
import { createSignal } from 'solid-js';
import {
  RoutineWebhookUrl,
  type RoutineWebhookUrlState,
} from './components/routine-webhook-url';
import {
  useIssueRoutineWebhookMutation,
  useRevokeRoutineWebhookMutation,
  useRoutineWebhookQuery,
} from './queries/webhooks';

function SavedRoutineWebhookUrl(props: { routineId: string }) {
  const webhook = useRoutineWebhookQuery(() => props.routineId);
  const issue = useIssueRoutineWebhookMutation();
  const revoke = useRevokeRoutineWebhookMutation();
  const [issuedUrl, setIssuedUrl] = createSignal<string>();
  async function issueUrl() {
    const issued = await issue.mutateAsync(props.routineId);
    setIssuedUrl(scheduledActionWebhookEndpoint(issued.token));
  }
  const state = (): RoutineWebhookUrlState => {
    if (webhook.isPending) return { kind: 'loading' };
    if (webhook.isError) return { kind: 'error' };
    return {
      kind: 'ready',
      tokenPrefix: webhook.data?.tokenPrefix,
      issuedUrl: issuedUrl(),
      busy: issue.isPending || revoke.isPending,
      failed: issue.isError || revoke.isError,
    };
  };
  return (
    <RoutineWebhookUrl
      state={state()}
      onIssue={() => fireAndForget(issueUrl(), 'routines')}
      onRevoke={() => {
        setIssuedUrl(undefined);
        fireAndForget(revoke.mutateAsync(props.routineId), 'routines');
      }}
    />
  );
}

/** The routine's webhook URL; a routine not yet created has none. */
export function RoutineWebhookUrlView(props: { routineId?: string }) {
  return (
    <>
      {props.routineId ? (
        <SavedRoutineWebhookUrl routineId={props.routineId} />
      ) : (
        <RoutineWebhookUrl
          state={{ kind: 'unsaved' }}
          onIssue={() => undefined}
          onRevoke={() => undefined}
        />
      )}
    </>
  );
}
