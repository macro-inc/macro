import { BlockToolbar } from '@components/app/block-toolbar';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@components/app/split-layout/components/SplitLabel';
import { useBlockId } from '@core/block';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { Show } from 'solid-js';
import { CodeFileTypeChip } from '../component/CodeFileTypeChip';
import { CodeModeControl } from '../component/CodeModeControl';
import {
  type CodeHeaderProps,
  useCodeHeaderTools,
} from './shared/code-header-parts';

/** The code block's header on desktop. */
export function CodeHeader(props: CodeHeaderProps) {
  const blockId = useBlockId();
  const name = useBlockDocumentName();
  const { ops, openShare, actions } = useCodeHeaderTools();

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel badges={<CodeFileTypeChip />} />
        <Show when={props.isHtmlFile}>
          <div class="ph-no-capture mx-2 h-full min-w-0 shrink-0">
            <CodeModeControl
              mode={props.mode}
              onModeChange={props.onModeChange}
            />
          </div>
        </Show>
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>

      <BlockToolbar
        tools={[actions.askMacro]}
        trailing={<ShareTrigger onClick={openShare} />}
        menuTools={[actions.askMacro, actions.share]}
        ops={ops}
        id={blockId}
        itemType="document"
        name={name() ?? ''}
      />
    </>
  );
}
