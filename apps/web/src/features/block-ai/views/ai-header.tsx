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
import { FileTypeChip } from '@core/component/FileTypeChip';
import { BlockLiveIndicators } from '@core/component/LiveIndicators';
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { type AiHeaderProps, aiHeaderTools } from './shared/ai-header-parts';

/** The ai block's header on desktop. */
export function AiHeader(props: AiHeaderProps) {
  const documentId = useBlockId();
  const name = useBlockDocumentName('Illustration');
  const { ops, actions } = aiHeaderTools(props);

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel badges={<FileTypeChip />} />
      </SplitHeaderLeft>
      <SplitHeaderRight>
        <BlockLiveIndicators />
      </SplitHeaderRight>
      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>
      <BlockToolbar
        trailing={<ShareTrigger onClick={props.openShare} />}
        menuTools={[actions.share]}
        ops={ops}
        id={documentId}
        itemType="document"
        name={name() ?? ''}
      />
    </>
  );
}
