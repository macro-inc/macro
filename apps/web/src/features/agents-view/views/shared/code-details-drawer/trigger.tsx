import { t } from '@app/lib/i18n';
import { MobileDrawer } from '@components/app/mobile/MobileDrawer';
import { Button, cn } from '@ui';
import { SessionCodeIcon } from '../../../components/session-code-icon/session-code-icon';
import { useCodeDetails } from './context';

export function CodeDetailsTrigger(props: { class?: string }) {
  const state = useCodeDetails();
  return (
    <MobileDrawer.Trigger
      as={Button}
      variant="ghost"
      size="icon-md"
      class={cn('shrink-0', props.class)}
      aria-label={
        state.details().pullRequest
          ? t('agentWork.pullRequestDetails')
          : t('agentWork.branchDetails')
      }
      onClick={(event: MouseEvent) => event.stopPropagation()}
    >
      <SessionCodeIcon details={state.details()} />
    </MobileDrawer.Trigger>
  );
}
