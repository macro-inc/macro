import { useDrawerControl } from '@app/component/split-layout/components/SplitDrawerContext';
import {
  type BlockTool,
  ToolButton,
} from '@app/component/split-layout/components/BlockTool';
import { SplitFileMenu } from '@app/component/split-layout/components/SplitFileMenu';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@app/component/split-layout/components/SplitHeader';
import {
  SplitHeaderBadge,
  StaticSplitLabel,
} from '@app/component/split-layout/components/SplitLabel';
import { SplitToolbarRight } from '@app/component/split-layout/components/SplitToolbar';
import {
  ShareTrigger,
  useShareDialogContext,
} from '@core/component/TopBar/ShareButton';
import { ENABLE_EMAIL_SHARING } from '@core/constant/featureFlags';
import { isMobile } from '@core/mobile/isMobile';
import IconShared from '@icon/regular/share.svg';
import TagIcon from '@icon/regular/tag.svg';
import { For, Show } from 'solid-js';
import { EmailPropertiesButton } from './EmailPropertiesModal';

export function TopBar(props: {
  id: string;
  title: string;
  isDraft?: boolean;
}) {
  const propertiesControl = useDrawerControl('properties');
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

      <Show
        when={isMobile()}
        fallback={
          <SplitToolbarRight>
            <For each={tools}>
              {(tool) => (
                <Show when={!tool.condition || tool.condition()}>
                  {tool.buttonComponent ? (
                    <tool.buttonComponent />
                  ) : (
                    <ToolButton tool={tool} />
                  )}
                </Show>
              )}
            </For>
          </SplitToolbarRight>
        }
      >
        <SplitHeaderRight>
          <SplitFileMenu
            id={props.id}
            itemType="email"
            name={props.title}
            ops={[]}
            tools={tools}
          />
        </SplitHeaderRight>
      </Show>
    </>
  );
}
