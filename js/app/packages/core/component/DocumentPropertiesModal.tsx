import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import type { BlockName } from '@core/block';
import { LabelAndHotKey } from '@core/component/Tooltip';
import { PropertiesView } from '@core/component/Properties/PropertiesView';
import { Button } from '@ui';
import { useCanEdit } from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import TagIcon from '@icon/regular/tag.svg';
import type { EntityType } from '@service-properties/generated/schemas/entityType';
import { Suspense } from 'solid-js';

export const PROPERTIES_DRAWER_ID = 'properties';
const DRAWER_ID = PROPERTIES_DRAWER_ID;

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

export function DocumentPropertiesButton(props: {
  buttonSize?: 'sm' | 'base';
  onOpenChange?: (open: boolean) => void;
}) {
  const drawerControl = useDrawerControl(DRAWER_ID);
  return (
    <Button
      variant={drawerControl.isOpen() ? 'active' : 'ghost'}
      size={props.buttonSize === 'sm' ? 'icon-sm' : 'icon-md'}
      tooltip={<LabelAndHotKey label="Properties" />}
      onClick={() => {
        props.onOpenChange?.(!drawerControl.isOpen());
        drawerControl.toggle();
      }}
    >
      <TagIcon />
    </Button>
  );
}

export function DocumentPropertiesDrawer(props: { blockType: BlockName }) {
  const canEdit = useCanEdit();
  return (
    <SplitDrawer id={DRAWER_ID} side="right" size={550} title="Properties">
      <Suspense fallback={<LoadingFallback />}>
        <DocumentPropertiesContent
          blockType={props.blockType}
          canEdit={canEdit()}
        />
      </Suspense>
    </SplitDrawer>
  );
}

function LoadingFallback() {
  return (
    <div class="flex justify-center items-center py-8">
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-ink-muted"></div>
    </div>
  );
}
