import { useSplitLayout } from '@components/app/split-layout/layout';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { fireAndForget } from '@core/util/fireAndForget';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { Telemetry } from '@macro-inc/observability';
import { getItemPreview, isAccessiblePreviewItem } from '@queries/preview';

/** Capture the database's source panel before the authorized preview resolves. */
export function createDatabaseDocumentNavigation() {
  const { openWithSplit } = useSplitLayout();
  async function open(id: string) {
    await Telemetry.span('database.reference.open', async (span) => {
      span.setAttr('document.id', id);
      const preview = await getItemPreview({ type: 'document', id });
      if (!isAccessiblePreviewItem(preview)) return;
      openWithSplit(
        {
          type: fileTypeToBlockName(preview.subType?.type ?? preview.fileType),
          id,
        },
        { preferNewSplit: openInNewSplitForMention(undefined, true) }
      );
    });
  }
  return (id: string) => fireAndForget(open(id), 'database');
}
