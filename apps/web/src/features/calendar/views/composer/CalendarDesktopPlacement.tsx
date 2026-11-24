import { type JSX, type ParentProps, Show } from 'solid-js';
import { ComposerClose } from '../../components/composer/actions/ComposerClose';
import { ComposerPin } from '../../components/composer/actions/ComposerPin';
import { ComposerHeaderKind } from '../../components/composer/desktop/ComposerHeaderKind';
import { DesktopComposerFields } from '../../components/composer/desktop/DesktopComposerFields';
import { DesktopComposerFooter } from '../../components/composer/desktop/DesktopComposerFooter';
import { ComposerHeader } from '../../components/composer/parts/ComposerHeader';
import { useCalendarComposer } from '../../context/calendar-composer-context';

type DesktopPlacementProps = ParentProps<{
  onClose: () => void;
  onTogglePin?: () => void;
  onHeaderPointerDown?: JSX.EventHandler<HTMLDivElement, PointerEvent>;
}>;

import type { DesktopComposerProps } from './DesktopComposer';

type CalendarDesktopPlacementProps = ParentProps<
  DesktopComposerProps & DesktopPlacementProps & { pinned?: boolean }
>;

/** Placement changes only the chrome; the mounted field tree retains its owner and inputs. */
export function CalendarDesktopPlacement(props: CalendarDesktopPlacementProps) {
  const model = useCalendarComposer();
  return (
    <div
      class="flex min-h-0 flex-1 flex-col gap-4"
      data-composer-placement={props.pinned ? 'pinned' : 'anchored'}
    >
      <ComposerHeader f3 onPointerDown={props.onHeaderPointerDown}>
        <Show when={model.isEdit()}>
          <ComposerHeaderKind />
        </Show>
        <div class="flex-1" />
        <Show when={props.onTogglePin}>
          {(toggle) => (
            <ComposerPin
              pinned={props.pinned ?? false}
              onToggle={toggle()}
              disabled={model.formIsDisabled()}
            />
          )}
        </Show>
        <ComposerClose f3 onClose={props.onClose} />
      </ComposerHeader>
      <DesktopComposerFields
        pinned={props.pinned}
        saveError={props.saveError}
        resolveAppLink={props.resolveAppLink}
      >
        {props.children}
      </DesktopComposerFields>
      <DesktopComposerFooter f3 onCancel={props.onClose} />
    </div>
  );
}
