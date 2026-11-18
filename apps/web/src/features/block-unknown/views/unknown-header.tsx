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
import { ShareTrigger } from '@core/component/TopBar/ShareButton';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import { useUnknownHeaderTools } from './shared/unknown-header-parts';

/** The unknown file block's header on desktop. */
export function UnknownHeader(props: { onShare: () => void }) {
  const blockId = useBlockId();
  const fileName = useBlockDocumentName();
  const { ops, actions } = useUnknownHeaderTools(props.onShare);

  return (
    <>
      <SplitHeaderLeft>
        <BlockItemSplitLabel badges={<FileTypeChip />} />
      </SplitHeaderLeft>

      <SplitHeaderRight>
        <SplitPermissionsBadge />
      </SplitHeaderRight>

      <BlockToolbar
        trailing={<ShareTrigger onClick={props.onShare} />}
        menuTools={[actions.share]}
        ops={ops}
        id={blockId}
        itemType="document"
        name={fileName() ?? ''}
      />
    </>
  );
}
