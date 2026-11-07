import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import { TraceFlow, usePending } from '@app/observability/flow';
import { enableTeamAgents } from '@core/constant/featureFlags';
import { fireAndForget } from '@core/util/fireAndForget';
import { thrownResultErrorHasCode } from '@core/util/result';
import {
  generateAgentAvatar,
  useUploadAgentAvatarMutation,
} from '@queries/agents/avatar';
import { queryReadyGate } from '@queries/gate';
import {
  useCreateTeamAgentMutation,
  useTeamAgentQuoteQuery,
  useTeamAgentSizesQuery,
} from '@queries/team-agents';
import { useVoicePickerSource } from '@queries/team-agents/voices';
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
  const standardQuote = useTeamAgentQuoteQuery(
    () => props.teamId,
    () => 'standard',
    () => true
  );
  const largeQuote = useTeamAgentQuoteQuery(
    () => props.teamId,
    () => 'large',
    () => true
  );
  const xlQuote = useTeamAgentQuoteQuery(
    () => props.teamId,
    () => 'xl',
    () => true
  );
  const create = useCreateTeamAgentMutation();
  const voices = useVoicePickerSource(() => props.teamId);
  const upload = useUploadAgentAvatarMutation();
  usePending('team-agent.sizes', () => sizes.isLoading);
  usePending('team-agent.quote', () => quote.isLoading);
  return (
    <InviteAgentForm
      open
      teamId={props.teamId}
      onClose={props.onClose}
      size={size()}
      setSize={setSize}
      voices={voices}
      portrait={{
        upload: (file) => upload.mutateAsync(file),
        generate: generateAgentAvatar,
      }}
      source={{
        quoteForSize: (value) => {
          const quotes = {
            standard: standardQuote,
            large: largeQuote,
            xl: xlQuote,
          };
          const query = quotes[value];
          return queryReadyGate(query) ? query.data : undefined;
        },
        specsForSize: (value) =>
          queryReadyGate(sizes)
            ? sizes.data.sizes.find((spec) => spec.size === value)
            : undefined,
        needsSubscription: () =>
          thrownResultErrorHasCode(quote.error, 'no_subscription'),
        quote: () => (queryReadyGate(quote) ? quote.data : undefined),
        quoteLoading: () => quote.isFetching,
        quoteError: () => quote.isError,
        reloadQuote: () => {
          fireAndForget(quote.refetch(), 'team-agent.quote.retry');
        },
        pending: () => create.isPending,
        create: (request, parentSpan) =>
          create.mutateAsync({ teamId: props.teamId, request, parentSpan }),
      }}
    />
  );
}

export function InviteAgentDialog(props: {
  teamId: string;
  open: boolean;
  onClose(): void;
}) {
  const flag = useFeatureFlag(enableTeamAgents);
  return (
    <Show when={props.open}>
      <Show
        when={!flag().loading}
        fallback={<p role="status">{t('agentInvite.loadingFeatures')}</p>}
      >
        <Show when={flag().enabled}>
          <Suspense
            fallback={<p role="status">{t('agentInvite.loadingInvitation')}</p>}
          >
            <TraceFlow
              name="team-agent.invite.open"
              attributes={{
                'team.id': props.teamId,
                'computer.size': 'standard',
              }}
            >
              <ConnectedInviteAgentForm
                teamId={props.teamId}
                onClose={props.onClose}
              />
            </TraceFlow>
          </Suspense>
        </Show>
      </Show>
    </Show>
  );
}
