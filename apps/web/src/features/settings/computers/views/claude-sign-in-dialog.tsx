import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type ClaudeSignInEntry,
  useClaudeSignOutMutation,
} from '@queries/computers/claude';
import { ActionDialogShell, Dialog } from '@ui';
import { ClaudeSignInFlow } from './claude-sign-in-flow';

/** Sign in with Claude from a computer's or agent's row, outside guided setup. */
export function ClaudeSignInDialog(props: {
  harnessId: string;
  entry: ClaudeSignInEntry;
  onClose: () => void;
}) {
  const signOut = useClaudeSignOutMutation();
  const useCredits = async () => {
    try {
      await signOut.mutateAsync(props.harnessId);
      props.onClose();
    } catch {
      toast.failure(t('computers.claudeCreditsFailed'));
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
          onSignedIn={() => {
            props.onClose();
            toast.success(t('computers.claudeSignedIn'));
          }}
          onUseCredits={() => fireAndForget(useCredits(), 'computer-claude')}
        />
      </ActionDialogShell>
    </Dialog>
  );
}
