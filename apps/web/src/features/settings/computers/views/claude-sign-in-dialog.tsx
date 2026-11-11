import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import { useClaudeSignOutMutation } from '@queries/computers/claude';
import { ActionDialogShell, Dialog } from '@ui';
import { ClaudeSignInFlow } from './claude-sign-in-flow';

/** Sign in with Claude from a computer's row or menu, outside guided setup. */
export function ClaudeSignInDialog(props: {
  harnessId: string;
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
          onSignedIn={(account) => {
            props.onClose();
            if (account)
              toast.success(t('computers.claudeConnectedAs', { account }));
          }}
          onUseCredits={() => fireAndForget(useCredits(), 'computer-claude')}
        />
      </ActionDialogShell>
    </Dialog>
  );
}
