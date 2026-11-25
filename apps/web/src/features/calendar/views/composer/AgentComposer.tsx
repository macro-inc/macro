import AgentMark from '@icon/system/regular/sparkle.svg';
import type { ComponentProps } from 'solid-js';
import { ComposerClose } from '../../components/composer/actions/ComposerClose';
import { DesktopComposerFields } from '../../components/composer/desktop/DesktopComposerFields';
import { DesktopComposerFooter } from '../../components/composer/desktop/DesktopComposerFooter';
import type { ComposerDescription } from '../../components/composer/parts/ComposerDescription';
import { ComposerHeader } from '../../components/composer/parts/ComposerHeader';

export function AgentComposer(props: {
  onCancel: () => void;
  resolveAppLink?: ComponentProps<typeof ComposerDescription>['resolveAppLink'];
}) {
  return (
    <div class="contents" data-composer-placement="agent">
      <ComposerHeader f3>
        <AgentMark class="size-4 text-ink-muted" />
        <div class="flex-1" />
        <ComposerClose onClose={props.onCancel} />
      </ComposerHeader>
      <DesktopComposerFields resolveAppLink={props.resolveAppLink} />
      <DesktopComposerFooter f3 onCancel={props.onCancel} />
    </div>
  );
}
