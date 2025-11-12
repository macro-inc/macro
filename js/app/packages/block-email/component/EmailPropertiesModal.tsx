import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import { IconButton } from '@core/component/IconButton';
import { PropertiesView } from '@core/component/Properties/PropertiesView';
import { useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import TagIcon from '@icon/regular/tag.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Suspense } from 'solid-js';

const DRAWER_ID = 'properties';

export function EmailPropertiesModal(props: {
  documentId: string;
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
          <EmailPropertiesContent canEdit={canEdit()} />
        </Suspense>
      </SplitDrawer>
    </>
  );
}

function EmailPropertiesContent(props: { canEdit: boolean }) {
  const documentName = useBlockDocumentName();

  return (
    <PropertiesView
      blockType={'email'}
      canEdit={props.canEdit}
      entityType={'THREAD' as EntityType}
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
