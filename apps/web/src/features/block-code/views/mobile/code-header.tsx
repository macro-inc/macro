import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { isMobile } from '@core/mobile/isMobile';
import { Show } from 'solid-js';
import { CodeFileTypeChip } from '../../component/CodeFileTypeChip';
import { CodeModeControl } from '../../component/CodeModeControl';
import {
  type CodeHeaderProps,
  useCodeHeaderTools,
} from '../shared/code-header-parts';

/**
 * The code block's header on touch: the title with its menu, the HTML view
 * mode on tablets, and Info.
 */
export function MobileCodeHeader(props: CodeHeaderProps) {
  const { ops, actions } = useCodeHeaderTools();

  return (
    <MobileBlockHeader
      badges={<CodeFileTypeChip />}
      menuTools={[actions.askMacro, actions.share]}
      ops={ops}
    >
      <Show when={props.isHtmlFile && !isMobile()}>
        <div class="ph-no-capture mx-2 h-full min-w-0 shrink-0">
          <CodeModeControl
            mode={props.mode}
            onModeChange={props.onModeChange}
          />
        </div>
      </Show>
    </MobileBlockHeader>
  );
}
