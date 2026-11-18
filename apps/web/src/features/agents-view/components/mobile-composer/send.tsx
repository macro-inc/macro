import ArrowUp from '@icon/system/bold/arrow-up-bold.svg';
import { Button } from '@ui';
import { useMobileComposer } from './context';

type MobileComposerSendProps = {
  disabled: boolean;
  blockedReason?: string;
  onSend: () => void;
};

export function MobileComposerSend(props: MobileComposerSendProps) {
  const state = useMobileComposer();
  return (
    <Button
      variant="primary"
      finish="flat"
      size={state.collapsed() ? 'icon-lg' : 'icon-md'}
      class="rounded-full bg-composer-action text-composer-action-ink data-disabled:opacity-50"
      aria-label="Send"
      tooltip="Send"
      title={props.blockedReason}
      disabled={props.disabled}
      onClick={props.onSend}
    >
      <ArrowUp class="size-5 shrink-0" />
    </Button>
  );
}
