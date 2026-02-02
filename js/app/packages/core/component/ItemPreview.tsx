import type { BlockAlias, BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isAccessiblePreviewItem, useItemPreview } from '@queries/preview';
import { matches } from '@core/util/match';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { truncateString } from '@core/util/string';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import BuildingIcon from '@icon/duotone/building-office-duotone.svg';
import EyeSlash from '@icon/duotone/eye-slash-duotone.svg';
import GlobeIcon from '@icon/duotone/globe-duotone.svg';
import ChannelIcon from '@icon/duotone/hash-duotone.svg';
import TrashSimple from '@icon/duotone/trash-simple-duotone.svg';
import User from '@icon/duotone/user-duotone.svg';
import ThreeUsersIcon from '@icon/duotone/users-three-duotone.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import type { NamedSubType } from '@macro-entity';
import type { ChannelType } from '@service-cognition/generated/schemas/channelType';
import type { ItemType } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import {
  insertProjectIntoHistory,
  postNewHistoryItem,
} from '@queries/history/history';
import { debounce } from '@solid-primitives/scheduled';
import { createSignal, Match, Show, Switch, Suspense } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { PopupPreview } from './DocumentPreview';
import { useSplitLayout } from '../../app/component/split-layout/layout';
import { DeprecatedTextButton } from './DeprecatedTextButton';
import {
  ENTITY_ICON_CONFIGS,
  EntityIcon,
  ICON_SIZE_CLASSES,
} from './EntityIcon';

type ItemPreviewProps = {
  itemId: string;
  itemType?: ItemType;
  cacheTimeSeconds?: number;
};

function useItemPreviewData(props: ItemPreviewProps) {
  const [item] = useItemPreview(() => ({
    id: props.itemId,
    type: props.itemType,
  }));

  const { replaceOrInsertSplit, insertSplit } = useSplitLayout();

  function openItem(blockOrFileType: string, id: string, inNewSplit?: boolean) {
    const targetBlock: BlockName | BlockAlias =
      fileTypeToBlockName(blockOrFileType);

    if (!targetBlock) {
      return;
    }

    if (inNewSplit) {
      const handle = insertSplit({
        type: targetBlock,
        id,
      });
      handle?.activate();
    } else {
      const handle = replaceOrInsertSplit({
        type: targetBlock,
        id,
      });
      handle?.activate();
    }
  }

  async function onPreviewClick(
    type: ItemPreviewProps['itemType'],
    id: string,
    fileType?: FileType,
    subType?: NamedSubType,
    altKey?: boolean
  ) {
    if (type === 'project') {
      insertProjectIntoHistory(id);
      await postNewHistoryItem('project', id);
    }
    const _type = subType ?? fileType ?? type;
    if (!_type) return;
    openItem(_type, id, openInNewSplitForMention(altKey, true));
  }

  const name = () => {
    const preview = item();

    if (preview.loading || preview.access !== 'access') {
      return 'Untitled';
    }

    const baseName = preview.name ?? 'Untitled';

    return baseName;
  };

  const blockConfig = () => ENTITY_ICON_CONFIGS['channel'];
  const sizeClass = () => ICON_SIZE_CLASSES['xs'];
  const className = () => {
    return `${sizeClass()} ${blockConfig().foreground}`;
  };

  const channelTypeIcon = (channelType: ChannelType | undefined) => {
    switch (channelType) {
      case 'direct_message':
        return User;
      case 'private':
        return ThreeUsersIcon;
      case 'organization':
        return BuildingIcon;
      case 'public':
        return GlobeIcon;
      default:
        return ChannelIcon;
    }
  };

  return {
    item,
    name,
    onPreviewClick,
    className,
    channelTypeIcon,
  };
}

function ButtonNoAccess() {
  return (
    <DeprecatedTextButton
      theme="base"
      icon={() => <EyeSlash class="text-ink-muted w-4 h-4" />}
      disabled
      text="No Access"
    />
  );
}

function InlineNoAccess() {
  return (
    <span class="inline-flex items-center gap-1.5">
      <span class="w-4 h-4">
        <EyeSlash class="text-ink-muted w-4 h-4" />
      </span>
      <span class="text-ink-muted">No Access</span>
    </span>
  );
}

function ButtonDeleted() {
  return (
    <DeprecatedTextButton
      theme="base"
      icon={() => <TrashSimple class="text-ink-muted w-4 h-4" />}
      disabled
      text="Deleted"
    />
  );
}

function InlineDeleted() {
  return (
    <span class="inline-flex items-center gap-1.5">
      <span class="w-4 h-4">
        <TrashSimple class="text-ink-muted w-4 h-4" />
      </span>
      <span class="text-ink-muted">Deleted</span>
    </span>
  );
}

function ButtonLoading() {
  return (
    <DeprecatedTextButton
      theme="base"
      icon={() => (
        <div class="w-4 h-4 animate-spin">
          <LoadingSpinner />
        </div>
      )}
      text="Loading..."
      disabled
    />
  );
}

function InlineLoading() {
  return (
    <span class="inline-flex items-center gap-1.5">
      <span class="w-4 h-4 animate-spin">
        <LoadingSpinner />
      </span>
      <span class="text-ink-muted">Loading...</span>
    </span>
  );
}

export function ItemPreview(props: ItemPreviewProps) {
  return (
    <Suspense>
      <ItemPreviewInner {...props} />
    </Suspense>
  );
}

function ItemPreviewInner(props: ItemPreviewProps) {
  const { item, name, onPreviewClick, className, channelTypeIcon } =
    useItemPreviewData(props);

  const [previewOpen, setPreviewOpen] = createSignal(false);
  const debouncedSetPreviewOpen = debounce(setPreviewOpen, 100);

  let buttonRef!: HTMLButtonElement;

  return (
    <Switch>
      <Match when={item().loading}>
        <ButtonLoading />
      </Match>
      <Match when={matches(item(), (i) => !i.loading)}>
        {(loadedItem) => (
          <Switch>
            <Match when={matches(loadedItem(), isAccessiblePreviewItem)}>
              {(accessibleItem) => {
                const itemData = accessibleItem();
                const fileType = itemData.fileType;
                const subType = itemData.subType?.type as
                  | NamedSubType
                  | undefined;
                const blockName = fileTypeToBlockName(
                  subType ?? fileType ?? itemData.type
                );
                const navHandlers =
                  useSplitNavigationHandler<HTMLButtonElement>((e) =>
                    onPreviewClick(
                      itemData.type,
                      itemData.id,
                      fileType,
                      subType,
                      e.altKey
                    )
                  );
                return (
                  <>
                    <button
                      ref={buttonRef}
                      class="text-ink-base text-sm ring-1 ring-edge-muted rounded-xs hover:bg-panel-hover flex flex-row h-6 px-2 justify-center items-center cursor-pointer"
                      onMouseEnter={() => {
                        if (!isTouchDevice()) {
                          debouncedSetPreviewOpen(true);
                        }
                      }}
                      onMouseLeave={() => {
                        if (!isTouchDevice()) {
                          debouncedSetPreviewOpen.clear();
                          debouncedSetPreviewOpen(false);
                        }
                      }}
                      {...navHandlers}
                    >
                      <div class="flex justify-start items-center h-3.5 mr-2">
                        {itemData.type === 'channel' ? (
                          <div class={className()}>
                            <Dynamic
                              component={channelTypeIcon(itemData.channelType)}
                            />
                          </div>
                        ) : (
                          <EntityIcon
                            targetType={
                              itemData.type === 'document'
                                ? (subType ?? fileType)
                                : itemData.type
                            }
                            size="fill"
                          />
                        )}
                      </div>
                      <div class="flex-1 text-left leading-5 min-w-0 truncate">
                        {truncateString(name(), 80)}
                      </div>
                    </button>
                    <Show when={previewOpen() && blockName}>
                      <PopupPreview
                        item={item}
                        floatRef={buttonRef}
                        mouseEnter={() => {
                          debouncedSetPreviewOpen(true);
                        }}
                        mouseLeave={() => {
                          debouncedSetPreviewOpen.clear();
                          debouncedSetPreviewOpen(false);
                        }}
                        documentInfo={{
                          id: itemData.id,
                          type: blockName as BlockName,
                          params: {},
                          isOpenable: true,
                        }}
                      />
                    </Show>
                  </>
                );
              }}
            </Match>
            <Match when={loadedItem().access === 'no_access'}>
              <ButtonNoAccess />
            </Match>
            <Match when={loadedItem().access === 'does_not_exist'}>
              <ButtonDeleted />
            </Match>
          </Switch>
        )}
      </Match>
    </Switch>
  );
}

export function InlineItemPreview(props: ItemPreviewProps) {
  const { item, name, className, channelTypeIcon } = useItemPreviewData(props);

  return (
    <Switch>
      <Match when={item().loading}>
        <InlineLoading />
      </Match>
      <Match when={matches(item(), (i) => !i.loading)}>
        {(loadedItem) => (
          <Switch>
            <Match when={matches(loadedItem(), isAccessiblePreviewItem)}>
              {(accessibleItem) => {
                const itemData = accessibleItem();
                const fileType = itemData.fileType;
                const subType = itemData.subType?.type;
                return (
                  <span class="inline-flex items-center gap-1">
                    <span class="w-4 h-4">
                      {itemData.type === 'channel' ? (
                        <div class={className()}>
                          <Dynamic
                            component={channelTypeIcon(itemData.channelType)}
                          />
                        </div>
                      ) : (
                        <EntityIcon
                          targetType={
                            itemData.type === 'document'
                              ? (subType ?? fileType)
                              : itemData.type
                          }
                          size="xs"
                        />
                      )}
                    </span>
                    <span class="underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
                      {truncateString(name(), 80)}
                    </span>
                  </span>
                );
              }}
            </Match>
            <Match when={loadedItem().access === 'no_access'}>
              <InlineNoAccess />
            </Match>
            <Match when={loadedItem().access === 'does_not_exist'}>
              <InlineDeleted />
            </Match>
          </Switch>
        )}
      </Match>
    </Switch>
  );
}
