import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import { LabelAndHotKey } from '@core/component/Tooltip';
import { PropertiesView } from '@core/component/Properties/PropertiesView';
import { Button } from '@ui';
import { useCanEdit } from '@core/signal/permissions';
import TagIcon from '@icon/regular/tag.svg';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { Suspense } from 'solid-js';

export const PROPERTIES_DRAWER_ID = 'properties';
const DRAWER_ID = PROPERTIES_DRAWER_ID;

export function ProjectPropertiesButton(props: { buttonSize?: 'sm' | 'base' }) {
  const drawerControl = useDrawerControl(DRAWER_ID);
  return (
    <Button
      variant={drawerControl.isOpen() ? 'active' : 'ghost'}
      size={props.buttonSize === 'sm' ? 'icon-sm' : 'icon-md'}
      tooltip={<LabelAndHotKey label="Properties" />}
      onClick={drawerControl.toggle}
    >
      <TagIcon />
    </Button>
  );
}

export function ProjectPropertiesDrawer(props: { name?: string }) {
  const canEdit = useCanEdit();
  return (
    <SplitDrawer id={DRAWER_ID} side="right" size={550} title="Properties">
      <Suspense fallback={<LoadingFallback />}>
        <ProjectPropertiesContent canEdit={canEdit()} name={props.name} />
      </Suspense>
    </SplitDrawer>
  );
}

function ProjectPropertiesContent(props: { canEdit: boolean; name?: string }) {
  return (
    <PropertiesView
      blockType={'project'}
      canEdit={props.canEdit}
      entityType={EntityType.PROJECT}
      documentName={props.name}
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
