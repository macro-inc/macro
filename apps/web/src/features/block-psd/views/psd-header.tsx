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
import { type PsdHeaderProps, psdHeaderTools } from './shared/psd-header-parts';

/** The psd block's header on desktop. */
export function PsdHeader(props: PsdHeaderProps) {
  const documentId = useBlockId();
  const name = useBlockDocumentName('Image');
  const { ops, actions } = psdHeaderTools(props);

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
