import { usePending } from '@app/observability/flow';
import { fireAndForget } from '@core/util/fireAndForget';
import { queryReadyGate } from '@queries/gate';
import {
  useCreateTeamAgentMutation,
  useTeamAgentQuoteQuery,
} from '@queries/team-agents';
import type { ComputerSize } from '@service-auth/generated/schemas';
import { createSignal, Show, Suspense } from 'solid-js';
import { match } from 'ts-pattern';
import { InviteAgentForm } from './invite-agent-form';

function ConnectedInviteAgentForm(props: { teamId: string; onClose(): void }) {
  const [size, setSize] = createSignal<ComputerSize>('standard');
  const standard = useTeamAgentQuoteQuery(
    () => props.teamId,
    () => 'standard',
    () => true
  );
  const large = useTeamAgentQuoteQuery(
    () => props.teamId,
    () => 'large',
    () => true
  );
  const xl = useTeamAgentQuoteQuery(
    () => props.teamId,
    () => 'xl',
    () => true
  );
  const quoteForSize = (value: ComputerSize) =>
    match(value)
      .with('standard', () => standard)
      .with('large', () => large)
      .with('xl', () => xl)
      .exhaustive();
  const quote = () => quoteForSize(size());
  const create = useCreateTeamAgentMutation();
  usePending('team-agent.quote', () => quote().isLoading);
  return (
    <InviteAgentForm
      open
      onClose={props.onClose}
      size={size()}
      setSize={setSize}
      source={{
        quoteForSize: (value) => {
          const result = quoteForSize(value);
          return queryReadyGate(result) ? result.data : undefined;
        },
        quote: () => (queryReadyGate(quote()) ? quote().data : undefined),
        quoteLoading: () => quote().isFetching,
        quoteError: () => quote().isError,
        reloadQuote: () => {
          fireAndForget(quote().refetch(), 'team-agent.quote.retry');
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
