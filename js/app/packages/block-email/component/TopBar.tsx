import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import type { BlockTool } from '@app/component/ResponsiveBlockToolbar';
import { ResponsiveBlockToolbar } from '@app/component/ResponsiveBlockToolbar';
import { SplitHeaderLeft } from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import {
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import IconShared from '@icon/regular/share.svg';
import TagIcon from '@icon/regular/tag.svg';
import {
  EmailPropertiesButton,
  PROPERTIES_DRAWER_ID,
} from './EmailPropertiesModal';

export function TopBar(props: {
  id: string;
  title: string;
  isDraft?: boolean;
}) {
  const propertiesControl = useDrawerControl(PROPERTIES_DRAWER_ID);
  const shareCtx = useShareDialogContext();

  const tools: BlockTool[] = [
    {
      label: 'Properties',
      icon: TagIcon,
      action: propertiesControl.toggle,
      buttonComponent: () => <EmailPropertiesButton buttonSize="sm" />,
    },
    {
      label: 'Share',
      icon: IconShared,
      action: () => shareCtx.open(),
      divideAbove: true,
      condition: () => ENABLE_EMAIL_SHARING,
      buttonComponent: () => <ShareTrigger />,
    },
  ];

  return (
    <>
      <SplitHeaderLeft>
        <StaticSplitLabel
          iconType="email"
          label={props.title}
          badges={
            props.isDraft
              ? [
                  <SplitHeaderBadge
                    text="draft"
                    tooltip="This is a Draft Email"
                  />,
                ]
              : undefined
          }
        />
      </SplitHeaderLeft>

      <ResponsiveBlockToolbar
        tools={tools}
        ops={[]}
        id={props.id}
        itemType="email"
        name={props.title}
      />
    </>
  );
}
