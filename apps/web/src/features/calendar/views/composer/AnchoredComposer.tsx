import { type JSX, type ParentProps, Show } from 'solid-js';
import { ComposerClose } from '../../components/composer/actions/ComposerClose';
import { ComposerPin } from '../../components/composer/actions/ComposerPin';
import { DesktopComposerFooter } from '../../components/composer/desktop/DesktopComposerFooter';
import { ComposerHeader } from '../../components/composer/header/ComposerHeader';
import { useCalendarComposer } from '../../context/calendar-composer-context';

export interface DesktopPlacementProps extends ParentProps {
  onClose: () => void;
  onTogglePin?: () => void;
  onHeaderPointerDown?: JSX.EventHandler<HTMLDivElement, PointerEvent>;
  optionsToggle?: JSX.Element;
}
export function AnchoredComposer(props: DesktopPlacementProps) {
  const model = useCalendarComposer();
  return (
    <div class="contents" data-composer-placement="anchored">
      <ComposerHeader onPointerDown={props.onHeaderPointerDown}>
        <div class="flex-1" />
        <Show when={props.onTogglePin}>
          {(toggle) => (
            <ComposerPin
              pinned={false}
              onToggle={toggle()}
              disabled={model.formIsDisabled()}
            />
          )}
        </Show>
        <ComposerClose onClose={props.onClose} />
      </ComposerHeader>
      {props.children}
      <DesktopComposerFooter
        leading={props.optionsToggle}
        onCancel={props.onClose}
      />
    </div>
  );
}
