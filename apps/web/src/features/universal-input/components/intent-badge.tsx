import { isTouchDevice } from '@core/mobile/isTouchDevice';
import XIcon from '@icon/system/regular/x.svg';
import { Button, ButtonGroup, Hotkey } from '@ui';
import { Show } from 'solid-js';
import { type Intent, suggestionLabels } from '../core/input';
import { TypeIcon } from './type-icon';
import '../universal-input.css';

/**
 * The offer a host makes beside its own input once a type is recognized.
 * Taking it is one click or one key; refusing it is the only other control,
 * because the host's input already does something useful without either.
 */
export function IntentBadge(props: {
  intent: Intent;
  /** Shown beside the label on pointer devices; the host owns the binding. */
  shortcut?: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <ButtonGroup
      variant="outline"
      size="sm"
      label="Suggested type"
      class="universal-input-offer"
    >
      <Button
        variant="outline"
        size="sm"
        aria-keyshortcuts={props.shortcut}
        onClick={props.onOpen}
      >
        <TypeIcon intent={props.intent} />
        {suggestionLabels[props.intent]}
        <Show when={props.shortcut && !isTouchDevice()}>
          <Hotkey
            aria-hidden="true"
            shortcut={props.shortcut}
            theme="subtle"
            class="ml-0.5"
          />
        </Show>
      </Button>
      <ButtonGroup.Divider />
      <Button
        variant="outline"
        size="icon-sm"
        label="Dismiss suggestion"
        onClick={props.onDismiss}
      >
        <XIcon />
      </Button>
    </ButtonGroup>
  );
}
