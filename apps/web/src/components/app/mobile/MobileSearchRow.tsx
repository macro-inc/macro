import {
  CREATABLE_BLOCKS,
  type CreatableBlock,
  runCreateAction,
} from '@app/features/command/Launcher';
import {
  MobileAskAiButton,
  MobileSearchInput,
} from '@app/features/command/mobile/MobileSearchInput';
import { SearchState } from '@app/features/command/mobile/mobileSearchState';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useHandleFileUpload } from '@app/util/handleFileUpload';
import {
  ENABLE_ANIMATED_ICONS,
  ENABLE_SNIPPETS_FLAG,
  ENABLE_SNIPPETS_OVERRIDE,
} from '@core/constant/featureFlags';
import { openFilePicker } from '@core/util/upload';
import PlusIcon from '@phosphor/plus.svg';
import UploadIcon from '@phosphor/upload-simple.svg';
import { cn } from '@ui';
import { Show } from 'solid-js';
import { MobileTouchMenu, type MobileTouchMenuItem } from './MobileTouchMenu';

// Rows render top → bottom, ending at the thumb, so bottom → top this reads
// Email, Message, Doc, Task, Agent, Folder, Code, Canvas, Snippet. Each name
// resolves to its first CREATABLE_BLOCKS match, which drops the
// desktop-only 'Channel' entry: it shares the 'channel' blockName with
// 'Message', so on mobile both would run the same create action.
const CREATE_MENU_BLOCK_ORDER: CreatableBlock['blockName'][] = [
  'snippet',
  'canvas',
  'code',
  'project',
  'chat',
  'task',
  'md',
  'channel',
  'email',
];

function CreateMenu() {
  const snippetsFlag = useFeatureFlag(ENABLE_SNIPPETS_FLAG, {
    enabledOverride: ENABLE_SNIPPETS_OVERRIDE,
  });
  const handleFileUpload = useHandleFileUpload();

  const blocks = () =>
    CREATE_MENU_BLOCK_ORDER.filter(
      (blockName) => blockName !== 'snippet' || snippetsFlag().enabled
    ).flatMap((blockName) => {
      const block = CREATABLE_BLOCKS.find((b) => b.blockName === blockName);
      return block ? [block] : [];
    });

  const uploadItem: MobileTouchMenuItem = {
    id: 'upload-file',
    label: 'Upload file',
    icon: UploadIcon,
    animateIcon: false,
    onSelect: () => {
      openFilePicker({ multiple: true }, async (files) => {
        await handleFileUpload(files, false);
      });
    },
  };

  return (
    <MobileTouchMenu
      triggerIcon={PlusIcon}
      // This row sits above the views row, so anchor the menu to the trigger
      // rather than the bottom chrome row.
      position="trigger-bottom"
      footerLabel="Create"
      items={[
        uploadItem,
        ...blocks().map((block) => {
          const useAnimatedIcon = ENABLE_ANIMATED_ICONS && block.animatedIcon;
          return {
            id: block.blockName,
            label: block.label,
            icon: useAnimatedIcon ? block.animatedIcon : block.icon,
            animateIcon: !!useAnimatedIcon,
            onSelect: () => runCreateAction(block.blockName),
          };
        }),
      ]}
    />
  );
}

type MobileSearchRowProps = {
  class?: string;
};

/**
 * The search/create row: the persistent search bar ("Search or ask AI...")
 * with the Create menu to its right. It sits in the accessory slot above the
 * views row (see MobileViewsRow), where per-view inputs (chat, compose, email
 * reply) replace it. While a search session is active the Create menu's slot
 * is taken by the "Ask AI" button.
 */
export function MobileSearchRow(props: MobileSearchRowProps) {
  return (
    <div
      class={cn(
        'flex items-center gap-3 px-(--mobile-chrome-gutter)',
        props.class
      )}
    >
      <MobileSearchInput />
      <Show when={!SearchState.isOpen()} fallback={<MobileAskAiButton />}>
        <CreateMenu />
      </Show>
    </div>
  );
}
