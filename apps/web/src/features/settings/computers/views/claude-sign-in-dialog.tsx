import { t } from '@app/lib/i18n';
import { toast } from '@core/component/Toast/Toast';
import { fireAndForget } from '@core/util/fireAndForget';
import {
  type ClaudeSignInEntry,
  useClaudeModeQuery,
  useClaudeSignOutMutation,
} from '@queries/computers/claude';
import { ActionDialogShell, Dialog } from '@ui';
import type { JSX } from 'solid-js';
import { ClaudeSignInFlow } from './claude-sign-in-flow';

/** Sign in with Claude from a computer's or agent's row, outside guided setup. */
export function ClaudeSignInDialog(props: {
  harnessId: string;
  entry: ClaudeSignInEntry;
  onClose: () => void;
  /** Replaces the default title, e.g. "Bring your AI to Ada". */
  title?: string;
  /** Shown above the title, e.g. the computer's setup progress. */
  header?: JSX.Element;
  /** Replaces the default toast once signed in. */
  onSignedIn?: () => void;
}) {
  const signOut = useClaudeSignOutMutation();
  const mode = useClaudeModeQuery(() => props.harnessId);
  const useCredits = async () => {
    // Already on credits: nothing to sign out of.
    if (mode.data?.mode === 'macro_credits') {
      props.onClose();
      return;
    }
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
          title={props.title}
          header={props.header}
          onClose={props.onClose}
          onSignedIn={() => {
            props.onClose();
            if (props.onSignedIn) props.onSignedIn();
            else toast.success(t('computers.claudeSignedIn'));
          }}
          onUseCredits={() => fireAndForget(useCredits(), 'computer-claude')}
        />
      </ActionDialogShell>
    </Dialog>
  );
}
