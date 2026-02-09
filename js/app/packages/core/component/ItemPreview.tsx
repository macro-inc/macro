import type { BlockAlias, BlockName } from '@core/block';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  isAccessiblePreviewItem,
  useItemPreview,
  type ItemEntity,
} from '@queries/preview';
import { matches } from '@core/util/match';
import { openInNewSplitForMention } from '@core/util/openInNewSplit';
import { truncateString } from '@core/util/string';
import { useSplitNavigationHandler } from '@core/util/useSplitNavigationHandler';
import EyeSlash from '@icon/duotone/eye-slash-duotone.svg';
import TrashSimple from '@icon/duotone/trash-simple-duotone.svg';
import LoadingSpinner from '@icon/regular/spinner.svg';
import type { NamedSubType } from '@macro-entity';
import type { ItemType } from '@service-storage/client';
import type { FileType } from '@service-storage/generated/schemas/fileType';
import {
  Match,
  Switch,
  Suspense,
  type ComponentProps,
  type Accessor,
} from 'solid-js';
import { PopupPreview } from './DocumentPreview';
import { HoverCard } from './HoverCard';
import { useSplitLayout } from '../../app/component/split-layout/layout';
import { DeprecatedTextButton } from './DeprecatedTextButton';
import { EntityIcon, getPreviewItemIconType } from './EntityIcon';

export function useItemPreviewData(entity: Accessor<ItemEntity>) {
  const [item] = useItemPreview(entity);

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
    type: ItemType | undefined,
    id: string,
    fileType?: FileType,
    subType?: NamedSubType,
    shiftKey?: boolean
  ) {
    const _type = subType ?? fileType ?? type;
    if (!_type) return;
    openItem(_type, id, openInNewSplitForMention(shiftKey, true));
  }

  const name = () => {
    const preview = item();

    if (preview.loading || preview.access !== 'access') {
      return 'Untitled';
    }

    const baseName = preview.name ?? 'Untitled';

    return baseName;
  };

  const targetType = () => {
    return getPreviewItemIconType(item());
  };

  const ItemEntityIcon = (
    localProps?: Partial<Omit<ComponentProps<typeof EntityIcon>, 'targetType'>>
  ) => {
    return <EntityIcon targetType={targetType()} {...localProps} />;
  };

  return {
    item,
    name,
    onPreviewClick,
    targetType,
    ItemEntityIcon,
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

export function ItemPreview(props: ItemEntity) {
  return (
    <Suspense>
      <ItemPreviewInner {...props} />
    </Suspense>
  );
}

function ItemPreviewInner(props: ItemEntity) {
  const { item, name, onPreviewClick, targetType, ItemEntityIcon } =
    useItemPreviewData(() => props);

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
                const blockName = () => {
                  const type = targetType();
                  const itemType = accessibleItem().type;
                  return fileTypeToBlockName(type ?? itemType);
                };
                const navHandlers =
                  useSplitNavigationHandler<HTMLButtonElement>((e) => {
                    const item = accessibleItem();
                    onPreviewClick(
                      item.type,
                      item.id,
                      item.fileType,
                      item.subType?.type as NamedSubType | undefined,
                      e.shiftKey
                    );
                  });
                return (
                  <HoverCard
                    disabled={isTouchDevice() || !blockName()}
                    trigger={
                      <button
                        class="text-ink-base text-sm ring-1 ring-edge-muted rounded-xs hover:bg-panel-hover flex flex-row h-6 px-2 justify-center items-center"
                        {...navHandlers}
                      >
                        <div class="flex justify-start items-center h-3.5 mr-2">
                          <ItemEntityIcon size="fill" />
                        </div>
                        <div class="flex-1 text-left leading-5 min-w-0 truncate">
                          {truncateString(name(), 80)}
                        </div>
                      </button>
                    }
                    content={
                      <PopupPreview
                        mouseEnter={() => {}}
                        mouseLeave={() => {}}
                        documentInfo={{
                          id: accessibleItem().id,
                          type: blockName() as BlockName,
                          params: {},
                          isOpenable: true,
                        }}
                      />
                    }
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

export function InlineItemPreview(props: ItemEntity) {
  const { item, name, ItemEntityIcon } = useItemPreviewData(() => props);

  return (
    <Switch>
      <Match when={item().loading}>
        <InlineLoading />
      </Match>
      <Match when={matches(item(), (i) => !i.loading)}>
        {(loadedItem) => (
          <Switch>
            <Match when={matches(loadedItem(), isAccessiblePreviewItem)}>
              <span class="inline-flex items-center gap-1">
                <span class="w-4 h-4">
                  <ItemEntityIcon size="xs" />
                </span>
                <span class="underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
                  {truncateString(name(), 80)}
                </span>
              </span>
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
