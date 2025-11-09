import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import type { BlockName } from '@core/block';
import { IconButton } from '@core/component/IconButton';
import { PropertiesView } from '@core/component/Properties/PropertiesView';
import { useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import TagIcon from '@icon/regular/tag.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Suspense } from 'solid-js';

const DRAWER_ID = 'properties';

export function DocumentPropertiesModal(props: {
  documentId: string;
  blockType: BlockName;
  buttonSize?: 'sm' | 'base';
}) {
  const drawerControl = useDrawerControl(DRAWER_ID);
  const canEdit = useCanEdit();

  return (
    <>
      <IconButton
        icon={TagIcon}
        theme={drawerControl.isOpen() ? 'accent' : 'clear'}
        size={props.buttonSize ?? 'base'}
        tooltip={{ label: 'Properties' }}
        onClick={drawerControl.toggle}
      />
      <SplitDrawer id={DRAWER_ID} side="right" size={550} title="Properties">
        <Suspense fallback={<LoadingFallback />}>
          <DocumentPropertiesContent
            blockType={props.blockType}
            canEdit={canEdit()}
          />
        </Suspense>
      </SplitDrawer>
    </>
  );
}

function DocumentPropertiesContent(props: {
  blockType: BlockName;
  canEdit: boolean;
}) {
  const documentName = useBlockDocumentName();

  return (
    <PropertiesView
      blockType={props.blockType}
      canEdit={props.canEdit}
      entityType={'DOCUMENT' as EntityType}
      documentName={documentName()}
    />
  );
}

function LoadingFallback() {
  return (
    <div class="flex justify-center items-center py-8">
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-ink-muted"></div>
    </div>
  );
}
