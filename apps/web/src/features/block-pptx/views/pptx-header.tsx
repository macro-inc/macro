import { ChatWithAgentButton } from '@app/features/chat/ChatWithAgentButton';
import { BlockToolbar } from '@components/app/block-toolbar';
import { HeaderActionGroup } from '@components/app/HeaderActionGroup';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import {
  BlockItemSplitLabel,
  SplitPermissionsBadge,
} from '@components/app/split-layout/components/SplitLabel';
import { FileTypeChip } from '@core/component/FileTypeChip';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import {
  chatEntity,
  type PptxHeaderProps,
  pptxHeaderTools,
} from './shared/pptx-header-parts';

/** The slides block's header on desktop. */
export function PptxHeader(props: PptxHeaderProps) {
  const { ops, actions } = pptxHeaderTools(props);

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel badges={<FileTypeChip />} />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <BlockLiveIndicators />
      </SplitHeaderRight>
      <SplitHeaderRight>
        <div class="order-[999] flex items-center">
          <HeaderActionGroup label="Presentation actions">
            <ChatWithAgentButton
              grouped
              label="Ask Macro"
              entity={chatEntity(props)}
            />
          </HeaderActionGroup>
        </div>
      </SplitHeaderRight>
      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>
      <BlockToolbar
        trailing={<ShareTrigger onClick={props.openShare} />}
        menuTools={[actions.share]}
        ops={ops}
        id={props.documentId}
        itemType="document"
        name={props.name()}
      />
    </>
  );
}
