import {
  runCreateAction,
  useCreatableEnabled,
} from '@app/features/command/Launcher';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { composeEmail } from './compose-email';
import { useEmailView } from './email-view-context';

type EmailCreateAction = {
  label: string;
  run: () => void;
};

/**
 * What the view's create button makes. A reminder is the one thing you make
 * from the Reminders tab rather than triage into it, so the button follows
 * the tab; every other tab composes an email in the current inbox scope.
 * Gated like every other reminder affordance — with the flag off the tab is
 * hidden anyway, so this is belt and braces.
 */
export function useEmailCreateAction(): () => EmailCreateAction {
  const { openWithSplit } = useSplitLayout();
  const { state } = useEmailView();
  const isCreatableEnabled = useCreatableEnabled();

  return () =>
    state.tab === 'reminders' && isCreatableEnabled('reminder')
      ? {
          label: 'New reminder',
          run: () => runCreateAction('reminder'),
        }
      : {
          label: 'New email',
          run: () => composeEmail(openWithSplit, state.inboxIds),
        };
}
