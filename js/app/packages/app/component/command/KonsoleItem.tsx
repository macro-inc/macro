import { URL_PARAMS as CHANNEL_PARAMS } from '@block-channel/constants';
import { URL_PARAMS as MD_PARAMS } from '@block-md/constants';
import { URL_PARAMS as PDF_PARAMS } from '@block-pdf/signal/location';
import type { BlockName } from '@core/block';
import { BozzyBracket } from '@core/component/BozzyBracket';
import type { ChannelsContext } from '@core/component/ChannelsProvider';
import { Hotkey } from '@core/component/Hotkey';
import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { Message } from '@core/component/Message';
import { UserIcon } from '@core/component/UserIcon';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { ENABLE_GMAIL_BASED_CONTACTS } from '@core/constant/featureFlags';
import { HotkeyTags } from '@core/hotkey/constants';
import {
  type CommandWithInfo,
  getActiveCommandsFromScope,
} from '@core/hotkey/getCommands';
import { pressedKeys } from '@core/hotkey/state';
import type { HotkeyCommand } from '@core/hotkey/types';
import { runCommand } from '@core/hotkey/utils';
import type { BlockOrchestrator } from '@core/orchestrator';
import { type ChannelWithParticipants, idToDisplayName } from '@core/user';
import PushPin from '@phosphor-icons/core/regular/push-pin.svg?component-solid';
import Terminal from '@phosphor-icons/core/regular/terminal.svg?component-solid';
import type { Channel } from '@service-comms/generated/models/channel';
import type { Attachment } from '@service-email/generated/schemas';
import { useUserId } from '@service-gql/client';
import type { BasicDocumentFileType } from '@service-storage/generated/schemas/basicDocumentFileType';
import type { Item } from '@service-storage/generated/schemas/item';
import {
  CustomEntityIcon,
  EntityIcon,
  type EntityWithValidIcon,
} from 'core/component/EntityIcon';
import {
  type Component,
  createMemo,
  createSignal,
  type JSX,
  type JSXElement,
  Match,
  type Setter,
  Switch,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { useGlobalBlockOrchestrator } from '../GlobalAppState';
import { useSplitLayout } from '../split-layout/layout';
import { EmailCommandItem } from './EmailKonsoleItem';
import {
  cleanQuery,
  currentKonsoleMode,
  resetKonsoleMode,
  resetQuery,
  setKonsoleOpen,
} from './state';

//NOTE: used to help for virtualization
export const COMMAND_ITEM_PADDING = 6;
export const COMMAND_ITEM_HEIGHT = 20;
export const COMMAND_ITEM_MARGIN = 2;
export const [commandCategoryIndex, setCommandCategoryIndex] = createSignal(0);

export type ChannelLookup = Record<string, Channel>;

export function createChannelLookup(channelsContext: ChannelsContext) {
  return createMemo(() => {
    const lookup: ChannelLookup = {};
    const channels = channelsContext.channels();

    for (const channel of channels) {
      lookup[channel.id] = channel;
    }
    return lookup;
  });
}

// Context information for actions and stuff
export const [konsoleContextInformation, setKonsoleContextInformation] =
  createSignal<Record<string, unknown>>({});

// TODO: better naming?
export function hydrateChannel(
  item: CommandItemCard,
  lookup: ChannelLookup
): CommandItemCard {
  if (item.type === 'channel') {
    // TODO: error handling. what if channel doesn't exist?
    const chan = lookup[item.data.id];
    if (!chan) return item;
    item.data.channel_type = chan.channel_type;
    if (item.data.channel_type === 'direct_message') {
      item.data.participants = (chan as ChannelWithParticipants).participants;
    }
  }
  return item;
}

const DEFAULT_CATEGORIES = [
  { name: 'Selection', visible: false },
  { name: 'Everything', visible: true },
  { name: 'Channels', visible: true },
  { name: 'DMs', visible: true },
  { name: 'Notes', visible: true },
  { name: 'Documents', visible: true },
  { name: 'Chats', visible: true },
  { name: 'Folders', visible: true },
  { name: 'Emails', visible: true },
  { name: 'Contacts', visible: ENABLE_GMAIL_BASED_CONTACTS },
  { name: 'Companies', visible: ENABLE_GMAIL_BASED_CONTACTS },
] as const;

type DefaultCategoryNames = (typeof DEFAULT_CATEGORIES)[number]['name'];

type KonsoleCategory = {
  name: string;
  visible: boolean;
};

const [categories, setCategories] = createStore<KonsoleCategory[]>(
  DEFAULT_CATEGORIES.slice()
);

export const searchCategories = {
  getCateoryIndex(name: DefaultCategoryNames | (string & {})) {
    const index = categories.findIndex((c) => c.name === name);

    if (index === -1) return;

    return index;
  },
  hideCategory(name: DefaultCategoryNames | (string & {})) {
    setCategories((p) => p.name === name, 'visible', false);
  },
  showCategory(name: DefaultCategoryNames | (string & {})) {
    setCategories((p) => p.name === name, 'visible', true);
  },
  toggleCategory(name: DefaultCategoryNames | (string & {})) {
    setCategories(
      (p) => p.name === name,
      'visible',
      (p) => !p
    );
  },
  isCategoryActive(index: number) {
    if (categories[index].name === 'Emails') {
      // only use emails for the search bar
      if (currentKonsoleMode() !== 'FULL_TEXT_SEARCH') return false;

      // TODO only show emails if they are enabled
      // NOTE: this also seems to trigger a "computations created outside a 'createRoot' will never be disposed error
      //const emailActive = useEmailActive();
      const emailEnabled = () => {
        // TODO: this causes a loop
        //if (emailActive()?.link_exists) return true;
        return true;
      };
      return emailEnabled();
    }
    return true;
  },
  findNextCategoryIndex(category: number, backwards: boolean): number {
    let candidateCategory = -1;
    const length = categories.length;
    for (let i = 1; i < length; i++) {
      if (backwards) {
        candidateCategory = category - i;
      } else {
        candidateCategory = category + i;
      }

      // Perform wrap-around
      if (candidateCategory >= length) {
        candidateCategory = 0;
      } else if (candidateCategory < 0) {
        candidateCategory = length + candidateCategory;
      }

      if (this.isCategoryActive(candidateCategory)) break;
      candidateCategory = -1;
    }
    return candidateCategory;
  },
  listVisible() {
    return [...categories.filter((c) => c.visible)];
  },
  listAll() {
    return [...categories];
  },
};

export const resetCommandCategoryIndex = () => {
  const everything = DEFAULT_CATEGORIES[1].name;
  const indexOfEverything = searchCategories
    .listVisible()
    .findIndex((c) => c.name === everything);

  setCommandCategoryIndex(indexOfEverything === -1 ? 0 : indexOfEverything);
};

export type SearchSnippet = {
  content: string;
  locationId: string;
  fileType: string;
  matchIndex?: number;
  senderId?: string;
};

type CommandItemBase = {
  snippet?: SearchSnippet;
  height?: number;
  // Add an optional timestamp to pass to fresh search/sort
  updatedAt?: number | string;
};

type SimpleText = {
  // id + name are needed to match the shape of channels/items
  id: string;
  name: string;
  text: string;
};

type LoadMore = {
  // id + name are needed to match the shape of channels/items
  id: string;
  name: string;
};

export type EmailPreview = {
  id: string;
  name: string; // subject
  sender: string;
  timestamp: string;
  is_read: boolean;
  attachments: Attachment[];
};

export type ContactPreview = {
  id: string; // email address
  name: string;
  email: string;
  company?: string;
};

export type CompanyPreview = {
  id: string; // domain with @ prefix
  name: string; // company name
  domain: string;
};

type ItemPreview = {
  id: string;
  name: string;
  fileType?: BasicDocumentFileType;
  itemType: Item['type'];
};

export type CommandPreview = {
  id: string;
  icon?: Component<JSX.SvgSVGAttributes<SVGSVGElement>>;
  name: string;
  command: HotkeyCommand;
};

export type ChannelPreview = {
  id: string;
  name: string;
  channel_type?: Channel['channel_type'];
  participants?: ChannelWithParticipants['participants'];
};

export type CommandItemCard = (
  | {
      type: 'item';
      data: ItemPreview;
    }
  | {
      type: 'channel';
      data: ChannelPreview;
    }
  | {
      type: 'text';
      data: SimpleText;
    }
  | {
      type: 'email';
      data: EmailPreview;
    }
  | {
      type: 'contact';
      data: ContactPreview;
    }
  | {
      type: 'company';
      data: CompanyPreview;
    }
  | {
      type: 'loadmore';
      data: LoadMore;
      loadMoreCallback?: () => void;
    }
  | {
      type: 'command';
      data: CommandPreview;
    }
) &
  CommandItemBase;

async function gotoSnippetLocation(
  orchestrator: BlockOrchestrator,
  id: string,
  snippet: SearchSnippet,
  searchTerm: string
) {
  const handle = await orchestrator.getBlockHandle(id);
  if (!handle) return;
  switch (snippet.fileType) {
    case 'pdf':
    case 'docx':
      handle.goToLocationFromParams({
        [PDF_PARAMS.searchPage]: snippet.locationId,
        [PDF_PARAMS.searchMatchNumOnPage]: (snippet.matchIndex ?? 0).toString(),
        [PDF_PARAMS.searchTerm]: searchTerm,
      });
      break;
    case 'chat':
      handle.goToLocationFromParams({
        message_id: snippet.locationId,
      });
      break;
    case 'channel':
      handle.goToLocationFromParams({
        [CHANNEL_PARAMS.message]: snippet.locationId,
      });
      break;
    case 'md':
      handle.goToLocationFromParams({
        [MD_PARAMS.nodeId]: snippet.locationId,
      });
      break;
  }
}

// Actions on an item from the command palette
type ItemAction = 'open' | 'new-split';

export function useCommandItemAction(args: {
  setCommandScopeCommands: Setter<CommandWithInfo[]>;
}) {
  const { setCommandScopeCommands } = args;
  const { replaceSplit, insertSplit } = useSplitLayout();
  const blockOrchestrator = useGlobalBlockOrchestrator();

  return function itemAction(
    item: CommandItemCard | undefined,
    action: ItemAction
  ) {
    console.log('ITEM ACTION', item, action);
    if (!item) return;
    const blockName = getCommandItemBlockName(item);
    const id = item.data.id;
    const split = action === 'new-split' ? insertSplit : replaceSplit;

    if (blockName) {
      split({ type: blockName, id });
      if (item.snippet) {
        gotoSnippetLocation(blockOrchestrator, id, item.snippet, cleanQuery());
      }
    } else {
      switch (item.type) {
        case 'loadmore': {
          if (item.loadMoreCallback) {
            item.loadMoreCallback();
          }
          break;
        }
        case 'command': {
          if (item.data.command.activateCommandScopeId) {
            const commandScopeCommands = getActiveCommandsFromScope(
              item.data.command.activateCommandScopeId,
              {
                sortByScopeLevel: false,
                hideShadowedCommands: false,
                hideCommandsWithoutHotkeys: false,
                limitToCurrentScope: true,
              }
            );
            resetQuery();
            setCommandScopeCommands(commandScopeCommands);
            break;
          } else {
            setKonsoleOpen(false);
            resetQuery();
            resetKonsoleMode();
            runCommand(item.data.command);
            break;
          }
        }
      }
    }

    // Clear search term when item action is triggered
    if (item.type !== 'loadmore' && item.type !== 'command') {
      setKonsoleOpen(false); // Split handles focus.
      resetQuery();
      resetKonsoleMode();
    }
  };
}

export interface CommandItemProps {
  item: CommandItemCard;
  index: number;
  selected: boolean;
  itemAction: (item: CommandItemCard, action: ItemAction) => void;
  mouseEnter: (e: MouseEvent) => void;
  snippets?: Record<string, string>;
}

function getCommandItemBlockName(item: CommandItemCard): BlockName | undefined {
  if (item.type === 'item') {
    if (item.data.itemType === 'document' && item.data.fileType) {
      return fileTypeToBlockName(item.data.fileType);
    }
    return fileTypeToBlockName(item.data.itemType) ?? 'unknown';
  } else if (item.type === 'channel') {
    return 'channel';
  } else if (item.type === 'email') {
    return 'email';
  } else if (item.type === 'contact' || item.type === 'company') {
    return 'contact';
  } else {
    return undefined;
  }
}

function getCommandItemName(item: CommandItemCard): string {
  return item.data.name!;
}

export function filterItemByCategory(item: CommandItemCard) {
  const categories = searchCategories.listVisible();
  const category = categories[commandCategoryIndex()].name;

  // This should appear at the bottom of every category, if there are more items that need to be loaded
  if (item.type === 'loadmore') {
    return true;
  }

  if (category === 'Selection') {
    if (
      currentKonsoleMode() === 'SELECTION_MODIFICATION' &&
      item.type === 'command'
    ) {
      return item.data.command.tags?.includes(HotkeyTags.SelectionModification);
    }
    return false;
  }

  // Action items should always appear in the "Everything" category
  if (item.type === 'command') {
    return category === 'Everything';
  }

  switch (category) {
    case 'Channels':
      return (
        item.type === 'channel' &&
        (item.data.channel_type === 'organization' ||
          item.data.channel_type === 'private')
      );
    case 'DMs':
      return (
        item.type === 'channel' && item.data.channel_type === 'direct_message'
      );
    case 'Documents':
      return (
        item.type === 'item' &&
        item.data.itemType === 'document' &&
        fileTypeToBlockName(item.data.fileType) !== 'md'
      );
    case 'Notes':
      return (
        item.type === 'item' &&
        item.data.itemType === 'document' &&
        fileTypeToBlockName(item.data.fileType) === 'md'
      );
    case 'Chats':
      return item.type === 'item' && item.data.itemType === 'chat';
    case 'Emails':
      return item.type === 'email';
    case 'Contacts':
      return item.type === 'contact';
    case 'Companies':
      return item.type === 'company';
    case 'Folders':
      return item.type === 'item' && item.data.itemType === 'project';
    default:
      return true;
  }
}

export function CommandItemCard(props: CommandItemProps) {
  const blockName = () => getCommandItemBlockName(props.item);
  const userId = useUserId();
  const name = () => {
    const name = getCommandItemName(props.item);
    return name && name.length > 55 ? `${name.slice(0, 52)}...` : name;
  };

  const CommandItemContainer = ({ children }: { children?: JSXElement }) => {
    const optionKeyPressed = createMemo(() => {
      return pressedKeys().has('opt');
    });
    return (
      <div
        onMouseDown={() =>
          props.itemAction(
            props.item,
            optionKeyPressed() ? 'new-split' : 'open'
          )
        }
        onMouseEnter={props.mouseEnter}
        class="group flex flex-col px-2"
        style={`margin: ${COMMAND_ITEM_MARGIN}px 0`}
      >
        {children}
      </div>
    );
  };

  const CommandItemIcon = () => {
    return (
      <Switch>
        <Match when={props.item.type === 'command'}>
          <CustomEntityIcon
            icon={
              props.item.type === 'command'
                ? (props.item.data.icon ?? Terminal)
                : Terminal
            }
            size="sm"
          />
        </Match>
        <Match when={blockName()}>
          {(blockName) => {
            let targetType: EntityWithValidIcon = blockName();

            if (
              props.item.type === 'channel' &&
              props.item.data.channel_type === 'direct_message'
            ) {
              const participants = props.item.data.participants;
              if (participants && participants.length > 0) {
                const other = participants.filter((p) => {
                  return p.user_id !== userId();
                });
                if (other.length > 0) {
                  return (
                    <UserIcon
                      size="sm"
                      suppressClick
                      id={other[0].user_id}
                      isDeleted={false}
                    />
                  );
                }
                targetType = 'directMessage';
              }
            }
            return <EntityIcon targetType={targetType} size="sm" />;
          }}
        </Match>
      </Switch>
    );
  };

  const CommandItemName = () => {
    return (
      <span class="text-ink text-xs sm:text-sm font-medium font-sans grow overflow-hidden text-nowrap">
        {name()}
      </span>
    );
  };

  const CommandItemHotkey = () => {
    if (props.item.type !== 'command') return null;
    if (props.item.data.command.hotkeys?.length === 0) return null;
    return (
      <div class="pr-2 flex items-center justify-center text-[0.75rem] font-medium text-ink-extra-muted">
        <div class="p-2 py-0.5 border border-edge-muted/50 rounded-xs">
          <Hotkey
            shortcut={props.item.data.command.hotkeys?.at(0)}
            class="flex gap-1 items-center"
          />
        </div>
      </div>
    );
  };

  // TODO: move into separate component
  const CommandItemEntry = () => {
    return (
      <BozzyBracket active={props.selected} class="flex h-5">
        <div
          class="w-full"
          style={{
            'padding-top': `${COMMAND_ITEM_PADDING}px`,
            'padding-bottom': `${COMMAND_ITEM_PADDING}px`,
          }}
        >
          <Switch>
            <Match when={props.item.type === 'email' && props.item}>
              {(item) => (
                <EmailCommandItem
                  sender={item().data.sender}
                  subject={item().data.name}
                />
              )}
            </Match>
            <Match when={props.item.type === 'text' && props.item}>
              {(item) => <div>{item().data.text}</div>}
            </Match>
            <Match when={props.item.type === 'loadmore' && props.item}>
              {(_item) => <div>Load More</div>}
            </Match>
            <Match when={true}>
              <div
                class="w-full flex gap-1.5 items-center ml-auto text-ink-extra-muted h-5"
                style={{
                  height: `${COMMAND_ITEM_HEIGHT}px`,
                }}
              >
                <div class="flex w-full justify-between">
                  <div class="flex items-center">
                    <div class="size-8 flex items-center justify-center">
                      <CommandItemIcon />
                    </div>
                    <CommandItemName />
                  </div>
                  <CommandItemHotkey />
                </div>
              </div>
            </Match>
          </Switch>
        </div>
      </BozzyBracket>
    );
  };

  const FullTextSearchResultItemEntry = () => {
    if (!props.item.snippet) return ''; // this should never happen but it makes TS happy!
    const isActuallyMessage = props.item.type === 'channel';
    const snippet = (() => props.item.snippet!)();

    const timestamp =
      props.item.type === 'email'
        ? props.item.data.timestamp
        : props.item.updatedAt
          ? new Date(props.item.updatedAt).toISOString()
          : undefined;

    return (
      <Message
        focused={props.selected}
        isFirstMessage={true}
        isLastMessage={true}
        hideConnectors={true}
        senderId={snippet.senderId}
        customIconTargetType={blockName()}
      >
        <Message.TopBar
          name={idToDisplayName(snippet.senderId ?? props.item.data.name)}
          timestamp={timestamp}
          tagLabel={
            isActuallyMessage
              ? props.item.data.name
              : undefined /* Hide redundant name on non-chat things */
          }
          tagIcon={
            isActuallyMessage
              ? CommandItemIcon
              : undefined /* Hide redundant name on non-chat things */
          }
        />
        <Message.Body>
          <StaticMarkdown
            markdown={
              // TODO: This should be <m-search-match>
              snippet.content.replaceAll('\n', ' ')
            }
          />
        </Message.Body>
      </Message>
    );
  };

  return (
    <CommandItemContainer>
      <Switch fallback={<CommandItemEntry />}>
        <Match when={props.item.snippet?.content}>
          <FullTextSearchResultItemEntry />
        </Match>

        {/* Other modes can go here in the future */}
      </Switch>
    </CommandItemContainer>
  );
}

export function PinnedCommandItem(props: {
  item: CommandItemCard;
  itemAction: (item: CommandItemCard, action: ItemAction) => void;
}) {
  const type = () => getCommandItemBlockName(props.item);
  const name = () => getCommandItemName(props.item);

  return (
    <div
      onMouseDown={() => props.itemAction(props.item, 'open')}
      class="flex items-center shrink-0 gap-1.5 px-2 py-1.5 rounded-md hover:bg-hover hover-transition-bg cursor-pointer w-[calc(25%-6px)]"
      title={name()}
      style={{
        'padding-top': `${COMMAND_ITEM_PADDING}px`,
        'padding-bottom': `${COMMAND_ITEM_PADDING}px`,
      }}
    >
      <EntityIcon targetType={type()} size="sm" />
      <span class="text-xs font-medium text-ink truncate">{name()}</span>
      <PushPin class="w-3.5 h-3.5 text-ink-extra-muted shrink-0" />
    </div>
  );
}
