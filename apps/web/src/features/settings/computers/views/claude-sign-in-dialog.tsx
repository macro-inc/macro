import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type ClaudeSignInEntry,
  useClaudeModeQuery,
  useClaudeSignOutMutation,
} from '@queries/computers/claude';
import { ActionDialogShell, confirmDialog, Dialog } from '@ui';
import { computerFailureMessage } from '../core/computer-display';
import { ClaudeSignInFlow } from './claude-sign-in-flow';

/**
 * Sign in with Claude from a computer's or agent's row, outside guided setup.
 * Its one secondary action is Macro credits: on credits already, it only
 * closes; signed in (or expired), it signs the computer out first.
 */
export function ClaudeSignInDialog(props: {
  harnessId: string;
  entry: ClaudeSignInEntry;
  onClose: () => void;
  /** Replaces the default title, e.g. "Connect Ada to your Claude plan". */
  title?: string;
  /** Replaces the default line under the title. */
  description?: string;
  /** Small print under the sign-in, e.g. whose computer keeps it. */
  footnote?: string;
  /** Replaces the default toast once signed in. */
  onSignedIn?: () => void;
  /** Replaces the default question before signing out to Macro credits. */
  switchToCredits?: { title: string; body: string };
}) {
  const signOut = useClaudeSignOutMutation();
  const mode = useClaudeModeQuery(() => props.harnessId);
  // Unknown until the mode loads: closing is the safe reading. A failed
  // refetch keeps the last known mode, so gate on pending, not success.
  const onCredits = () => mode.isPending || mode.data?.mode !== 'own_account';
  const switchToCredits = async () => {
    const confirmed = await confirmDialog({
      title: props.switchToCredits?.title ?? t('computers.claudeSwitchTitle'),
      body: props.switchToCredits?.body ?? t('computers.claudeSwitchBody'),
      confirmLabel: t('computers.claudeSwitchToCredits'),
    });
    if (!confirmed) return;
    try {
      await signOut.mutateAsync(props.harnessId);
      props.onClose();
    } catch (error) {
      toast.failure(
        computerFailureMessage(error, t('computers.claudeCreditsFailed'))
      );
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => !open && props.onClose()}
      position="center"
      visibleScrim
      class="w-[min(440px,calc(100vw-16px))]"
    >
      <ActionDialogShell class="h-auto">
        <ClaudeSignInFlow
          harnessId={props.harnessId}
          entry={props.entry}
          title={props.title}
          description={props.description}
          footnote={props.footnote}
          secondary={
            onCredits()
              ? {
                  label: t('computers.claudeKeepCredits'),
                  onClick: props.onClose,
                }
              : {
                  label: t('computers.claudeSwitchToCredits'),
                  pending: signOut.isPending,
                  onClick: () =>
                    fireAndForget(switchToCredits(), 'computer-claude'),
                }
          }
          onSignedIn={(closed) => {
            // Closed already: a dialog opened since is another sign-in.
            if (!closed) props.onClose();
            if (props.onSignedIn) props.onSignedIn();
            else toast.success(t('computers.claudeSignedIn'));
          }}
        />
      </ActionDialogShell>
    </Dialog>
  );
}
