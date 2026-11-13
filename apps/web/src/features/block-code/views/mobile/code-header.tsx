import { MobileBlockHeader } from '@components/app/mobile-header/mobile-block-header';
import { useBlockAliasedName, useBlockId } from '@core/block';
import { isMobile } from '@core/mobile/isMobile';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
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
  const blockId = useBlockId();
  const blockAlias = useBlockAliasedName();
  const name = useBlockDocumentName();
  const { ops, actions } = useCodeHeaderTools();

  return (
    <MobileBlockHeader
      id={blockId}
      name={name() ?? ''}
      iconType={blockAlias}
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
