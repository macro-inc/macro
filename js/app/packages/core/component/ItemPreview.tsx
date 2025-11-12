import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isAccessiblePreviewItem, useItemPreview } from '@core/signal/preview';
import { matches } from '@core/util/match';
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
import type { ChannelType } from '@service-cognition/generated/schemas/channelType';
import type { ItemType } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import {
  insertProjectIntoHistory,
  postNewHistoryItem,
} from '@service-storage/history';
import { Match, Switch } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { useSplitLayout } from '../../app/component/split-layout/layout';
import {
  ENTITY_ICON_CONFIGS,
  EntityIcon,
  ICON_SIZE_CLASSES,
} from './EntityIcon';
import { TextButton } from './TextButton';

type ItemPreviewProps = {
  itemId: string;
  itemType?: ItemType;
  cacheTimeSeconds?: number;
};

function useItemPreviewData(props: ItemPreviewProps) {
  const [item] = useItemPreview({
    id: props.itemId,
    type: props.itemType,
  });

  const { replaceOrInsertSplit, insertSplit } = useSplitLayout();

  function openItem(blockOrFileType: string, id: string, inNewSplit?: boolean) {
    const targetBlock = fileTypeToBlockName(blockOrFileType);
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
    altKey?: boolean
  ) {
    if (type === 'project') {
      insertProjectIntoHistory(id);
      await postNewHistoryItem('project', id);
    }
    const _type = fileType ?? type;
    if (!_type) return;
    openItem(_type, id, altKey);
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
    <TextButton
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
    <TextButton
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
    <TextButton
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
  const { item, name, onPreviewClick, className, channelTypeIcon } =
    useItemPreviewData(props);

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
                const navHandlers =
                  useSplitNavigationHandler<HTMLButtonElement>((e) =>
                    onPreviewClick(
                      itemData.type,
                      itemData.id,
                      fileType,
                      e.altKey
                    )
                  );
                return (
                  <TextButton
                    theme="base"
                    icon={() => {
                      if (itemData.type === 'channel') {
                        return (
                          <div class={className()}>
                            <Dynamic
                              component={channelTypeIcon(itemData.channelType)}
                            />
                          </div>
                        );
                      }
                      return (
                        <EntityIcon
                          targetType={
                            itemData.type === 'document'
                              ? fileType
                              : itemData.type
                          }
                          size="xs"
                        />
                      );
                    }}
                    {...navHandlers}
                    text={truncateString(name(), 80)}
                    width="min-w-0"
                  />
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
                              ? fileType
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
