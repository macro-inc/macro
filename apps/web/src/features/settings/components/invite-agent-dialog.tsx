import { usePending } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import { queryReadyGate } from '@queries/gate';
import {
  useCreateTeamAgentMutation,
  useTeamAgentQuoteQuery,
  useTeamAgentSizesQuery,
} from '@queries/team-agents';
import type { ComputerSize } from '@service-auth/generated/schemas';
import { createSignal, Show, Suspense } from 'solid-js';
import { InviteAgentForm } from './invite-agent-form';

function ConnectedInviteAgentForm(props: { teamId: string; onClose(): void }) {
  const [size, setSize] = createSignal<ComputerSize>('standard');
  const sizes = useTeamAgentSizesQuery(() => props.teamId);
  const quote = useTeamAgentQuoteQuery(
    () => props.teamId,
    size,
    () => true
  );
  const create = useCreateTeamAgentMutation();
  usePending('team-agent.quote', () => quote.isLoading);
  return (
    <InviteAgentForm
      open
      onClose={props.onClose}
      size={size()}
      setSize={setSize}
      source={{
        specsForSize: (value) =>
          sizes.data?.sizes.find((spec) => spec.size === value),
        needsSubscription: () =>
          thrownResultErrorHasCode(quote.error, 'no_subscription'),
        quote: () => (queryReadyGate(quote) ? quote.data : undefined),
        quoteLoading: () => quote.isFetching,
        quoteError: () => quote.isError,
        reloadQuote: () => {
          fireAndForget(quote.refetch(), 'team-agent.quote.retry');
        },
        pending: () => create.isPending,
        error: () => create.isError,
        create: (request) =>
          create.mutateAsync({ teamId: props.teamId, request }),
      }}
    />
  );
}

export function InviteAgentDialog(props: {
  teamId: string;
  open: boolean;
  onClose(): void;
}) {
  return (
    <Show when={props.open}>
      <Suspense fallback={<p role="status">Loading invitation…</p>}>
        <ConnectedInviteAgentForm
          teamId={props.teamId}
          onClose={props.onClose}
        />
      </Suspense>
    </Show>
  );
}
