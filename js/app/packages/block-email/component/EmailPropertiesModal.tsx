import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import { PropertiesView } from '@core/component/Properties/PropertiesView';
import { LabelAndHotKey } from '@core/component/Tooltip';
import TagIcon from '@icon/regular/tag.svg';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { Button } from '@ui';
import { Suspense } from 'solid-js';

export const PROPERTIES_DRAWER_ID = 'properties';
const DRAWER_ID = PROPERTIES_DRAWER_ID;

export function EmailPropertiesButton(props: { buttonSize?: 'sm' | 'base' }) {
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

export function EmailPropertiesDrawer(props: {
  canEdit: boolean;
  subject?: string;
}) {
  return (
    <SplitDrawer id={DRAWER_ID} side="right" size={550} title="Properties">
      <Suspense fallback={<LoadingFallback />}>
        <EmailPropertiesContent
          canEdit={props.canEdit}
          subject={props.subject}
        />
      </Suspense>
    </SplitDrawer>
  );
}

function EmailPropertiesContent(props: { canEdit: boolean; subject?: string }) {
  return (
    <PropertiesView
      blockType={'email'}
      canEdit={props.canEdit}
      entityType={EntityType.THREAD}
      documentName={props.subject}
    />
  );
}

function LoadingFallback() {
  return (
    <div class="flex justify-center items-center py-8">
      <div class="animate-spin rounded-full size-6 border-b-2 border-ink-muted"></div>
    </div>
  );
}
