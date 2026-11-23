import { type ParentProps, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { CalendarComposerIdentity } from '../../components/composer/desktop/CalendarComposerIdentity';
import { ComposerAdditionalFields } from '../../components/composer/desktop/ComposerAdditionalFields';
import { ComposerOptionsToggle } from '../../components/composer/desktop/ComposerOptionsToggle';
import { ComposerWhenRoot } from '../../components/composer/when/ComposerWhenRoot';
import { createComposerPresentation } from '../../primitives/create-composer-presentation';
import {
  AnchoredComposer,
  type DesktopPlacementProps,
} from './AnchoredComposer';
import { DesktopComposer, type DesktopComposerProps } from './DesktopComposer';
import { PinnedComposer } from './PinnedComposer';

type CalendarDesktopPlacementProps = ParentProps<
  DesktopComposerProps & DesktopPlacementProps & { pinned?: boolean }
>;
function CalendarDesktopContent(props: CalendarDesktopPlacementProps) {
  const presentation = createComposerPresentation();
  // Create the field tree outside the placement switch: pinning moves its DOM, not its owner.
  const fields = (
    <DesktopComposer
      macroCallsEnabled={props.macroCallsEnabled}
      saveError={props.saveError}
      resolveAppLink={props.resolveAppLink}
      titleIcon={<CalendarComposerIdentity />}
      options={
        <Show when={props.pinned || presentation.expanded()}>
          <ComposerAdditionalFields resolveAppLink={props.resolveAppLink} />
        </Show>
      }
    >
      {props.children}
    </DesktopComposer>
  );
  return (
    <Dynamic
      component={props.pinned ? PinnedComposer : AnchoredComposer}
      onClose={props.onClose}
      onTogglePin={props.onTogglePin}
      onHeaderPointerDown={props.onHeaderPointerDown}
      optionsToggle={
        <Show when={!props.pinned}>
          <ComposerOptionsToggle
            expanded={presentation.expanded()}
            onToggle={presentation.toggle}
          />
        </Show>
      }
    >
      {fields}
    </Dynamic>
  );
}
export function CalendarDesktopPlacement(props: CalendarDesktopPlacementProps) {
  return (
    <ComposerWhenRoot>
      <CalendarDesktopContent {...props} />
    </ComposerWhenRoot>
  );
}
