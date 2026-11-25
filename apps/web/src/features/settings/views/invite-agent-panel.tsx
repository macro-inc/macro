import { useOptionalSplitRouter } from '@app/lib/split-router';
import { globalSplitManager } from '@app/signal/splitLayout';
import { paneOf } from '@components/app/split-layout/layoutManager';
import { fireAndForget } from '@core/util/fireAndForget';
import { useComputerOffersQuery } from '@queries/computers/computers';
import { createMemo } from 'solid-js';
import { openBilling } from '../../notifications/computer-setup-toast';
import { InviteAgentForm } from '../components/invite-agent-form';
import { useAddTeamAgent } from '../primitives/add-team-agent';
import { createAgentInviteDraft } from '../primitives/agent-invite-draft';

/** Waits in the invite until the owner can open the teammate's real DM. */
export function InviteAgentPanel(props: {
  teamId: string;
  onCancel: () => void;
  /** The agent was added; the dialog closes. */
  onInvited: () => void;
}) {
  const offers = useComputerOffersQuery(() => true);
  // What was typed before Update card took the admin to Billing.
  const draft = createAgentInviteDraft(props.teamId);
  const router = useOptionalSplitRouter();
  const navigation = createMemo(() => {
    const layout = globalSplitManager();
    const split = layout?.activeSplit();
    const pane = split && paneOf(split.id);
    return {
      layout,
      splitId: split?.id,
      content: split?.content(),
      entryId: pane && router?.entry(pane)?.id,
      pending: pane && router?.pending(pane),
    };
  });
  const add = useAddTeamAgent({
    teamId: () => props.teamId,
    captureFlow: () => {
      const initial = navigation();
      const url = window.location.href;
      return () =>
        !!initial.layout &&
        !initial.pending &&
        navigation() === initial &&
        window.location.href === url;
    },
    onReady: (channelId) => {
      const layout = navigation().layout;
      if (!layout) return;
      draft.forget();
      props.onInvited();
      layout.openWithSplit(
        { type: 'channel', id: channelId },
        { activate: true, referredFrom: null }
      );
    },
    onAbandoned: props.onCancel,
  });

  return (
    <InviteAgentForm
      offers={offers.isSuccess ? offers.data : undefined}
      offersFailed={offers.isError}
      onRetryOffers={() => fireAndForget(offers.refetch(), 'team-agent.offers')}
      state={add.state()}
      purchaseKey={add.purchaseKey()}
      initialName={draft.initial?.name}
      initialSize={draft.initial?.size}
      onCancel={() => {
        draft.forget();
        props.onCancel();
      }}
      onSubmit={(request, size) =>
        fireAndForget(add.add(request, size), 'team-agent.add')
      }
      onRetryStart={(agent) =>
        fireAndForget(add.retry(agent), 'team-agent.add')
      }
      onResume={() => fireAndForget(add.resume(), 'team-agent.add')}
      onEdit={add.edit}
      onBilling={({ name, size }) => {
        draft.save(name, size);
        props.onCancel();
        openBilling();
      }}
    />
  );
}
