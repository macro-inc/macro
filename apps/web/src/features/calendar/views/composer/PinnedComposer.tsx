import { Show } from 'solid-js';
import { ComposerClose } from '../../components/composer/actions/ComposerClose';
import { ComposerPin } from '../../components/composer/actions/ComposerPin';
import { DesktopComposerFooter } from '../../components/composer/desktop/DesktopComposerFooter';
import { ComposerHeader } from '../../components/composer/header/ComposerHeader';
import { useCalendarComposer } from '../../context/calendar-composer-context';
import type { DesktopPlacementProps } from './AnchoredComposer';
export function PinnedComposer(props: DesktopPlacementProps) {
  const model = useCalendarComposer();
  return (
    <div class="contents" data-composer-placement="pinned">
      <ComposerHeader onPointerDown={props.onHeaderPointerDown}>
        <div class="flex-1" />
        <Show when={props.onTogglePin}>
          {(toggle) => (
            <ComposerPin
              pinned
              onToggle={toggle()}
              disabled={model.formIsDisabled()}
            />
          )}
        </Show>
        <ComposerClose onClose={props.onClose} />
      </ComposerHeader>
      {props.children}
      <DesktopComposerFooter onCancel={props.onClose} />
    </div>
  );
}
