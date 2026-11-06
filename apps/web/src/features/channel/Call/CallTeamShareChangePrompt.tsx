import { t } from '@app/lib/i18n';
import { useKeyedPersistentToasts } from '@core/component/Toast/useKeyedPersistentToasts';
import { getDisplayName } from '@core/user/displayName';
import { tryMacroId } from '@core/user/macroId';
import { fireAndForget } from '@core/util/fireAndForget';
import type { useActiveCallTeamShare } from './use-toggle-share-with-team';

/**
 * Asks someone on a call to approve a team-sharing change another participant
 * proposed, for as long as it waits on them. Closing it is not an answer: the
 * Call sharing menu keeps the choice.
 */
export function CallTeamShareChangePrompt(props: {
  change: ReturnType<typeof useActiveCallTeamShare>['change'];
}) {
  useKeyedPersistentToasts({
    items: () => {
      const pending = props.change.pending();
      return pending && props.change.awaitsMyAnswer() ? [pending] : [];
    },
    key: (pending) =>
      `${props.change.callId()}:${pending.requestedBy}:${pending.shared}`,
    toast: (pending, dismiss) => {
      const name = getDisplayName(tryMacroId(pending.requestedBy));
      const answer = (approve: boolean) => {
        dismiss();
        fireAndForget(props.change.answer(approve), 'channel-call');
      };
      return {
        title: pending.shared
          ? t('calls.teamShareAskShare', { name })
          : t('calls.teamShareAskPrivate', { name }),
        actions: [
          {
            label: t('calls.teamShareApprove'),
            onClick: () => answer(true),
          },
          {
            label: t('calls.teamShareDecline'),
            onClick: () => answer(false),
          },
        ],
      };
    },
  });

  return null;
}
