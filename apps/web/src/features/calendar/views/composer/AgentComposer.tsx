import AgentMark from '@icon/system/regular/sparkle.svg';
import { createSignal, type ParentProps, Show } from 'solid-js';
import { ComposerClose } from '../../components/composer/actions/ComposerClose';
import { ComposerAdditionalFields } from '../../components/composer/desktop/ComposerAdditionalFields';
import { ComposerOptionsToggle } from '../../components/composer/desktop/ComposerOptionsToggle';
import { DesktopComposerFooter } from '../../components/composer/desktop/DesktopComposerFooter';
import { ComposerHeader } from '../../components/composer/parts/ComposerHeader';
import { DesktopComposer, type DesktopComposerProps } from './DesktopComposer';

export function AgentComposer(
  props: ParentProps<DesktopComposerProps & { onCancel: () => void }>
) {
  const [expanded, setExpanded] = createSignal(false);
  return (
    <div class="contents" data-composer-placement="agent">
      <ComposerHeader>
        <div class="flex-1" />
        <ComposerClose onClose={props.onCancel} />
      </ComposerHeader>
      <DesktopComposer
        {...props}
        titleIcon={<AgentMark class="size-4 text-ink-muted" />}
        options={
          <Show when={expanded()}>
            <ComposerAdditionalFields resolveAppLink={props.resolveAppLink} />
          </Show>
        }
      />
      <DesktopComposerFooter
        onCancel={props.onCancel}
        leading={
          <ComposerOptionsToggle
            expanded={expanded()}
            onToggle={() => setExpanded((value) => !value)}
          />
        }
      />
    </div>
  );
}
