import { SplitDrawer } from '@app/component/split-layout/components/SplitDrawer';
import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import { PropertiesView } from '@core/component/Properties/PropertiesView';
import TagIcon from '@icon/regular/tag.svg';
import { EntityType } from '@service-properties/generated/schemas/entityType';
import { Suspense } from 'solid-js';

const DRAWER_ID = 'properties';

export function EmailPropertiesModal(props: {
  buttonSize?: 'sm' | 'base';
  subject?: string;
}) {
  const drawerControl = useDrawerControl(DRAWER_ID);

  return (
    <>
      <DeprecatedIconButton
        icon={TagIcon}
        theme={drawerControl.isOpen() ? 'accent' : 'clear'}
        size={props.buttonSize ?? 'base'}
        tooltip={{ label: 'Properties' }}
        onClick={drawerControl.toggle}
      />
      <SplitDrawer id={DRAWER_ID} side="right" size={550} title="Properties">
        <Suspense fallback={<LoadingFallback />}>
          {/* canEdit is always true for email:
              - Email threads have no sharing mechanism (unlike documents)
              - If user can view the thread, it's from their connected account
              - This component only renders after email loads (Show guards in Block.tsx) */}
          <EmailPropertiesContent canEdit={true} subject={props.subject} />
        </Suspense>
      </SplitDrawer>
    </>
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
      <div class="animate-spin rounded-full h-6 w-6 border-b-2 border-ink-muted"></div>
    </div>
  );
}
