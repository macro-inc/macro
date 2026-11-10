import { DocumentTitleHoverCard } from '@app/components/entity-detail/DocumentTitleHoverCard';
import { t } from '@app/lib/i18n';
import { isInBlock, useBlockAliasedName, useBlockId } from '@core/block';
import {
  ContextMenuContent,
  MenuItem,
  MenuSeparator,
  SubTrigger,
} from '@core/component/ContextMenu';
import {
  EntityIcon,
  type EntityIconSelector,
} from '@core/component/EntityIcon';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { blockMetadataSignal } from '@core/signal/load';
import {
  useCanComment,
  useCanEdit,
  useCanView,
  useIsDocumentOwner,
} from '@core/signal/permissions';
import { useBlockDocumentName } from '@core/util/currentBlockDocumentName';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { ContextMenu } from '@kobalte/core/context-menu';
import { cn, Tooltip } from '@ui';
import {
  type Accessor,
  type Component,
  createMemo,
  For,
  type JSX,
  onCleanup,
  type ParentProps,
  Show,
} from 'solid-js';
import { Portal } from 'solid-js/web';
import {
  getSplitFileMenuActionSections,
  type SplitFileMenuAction,
  type SplitPanelContextType,
} from '../context';
import { useSplitDisplayName, useSplitPanelOrThrow } from '../layoutUtils';
import { SplitTitleName } from '../title-rename';
import { HeaderIsland } from './HeaderIsland';

export function StaticSplitLabel(props: {
  label: string;
  iconType?: EntityIconSelector;
  icon?: JSX.Element;
  badges?: JSX.Element;
  class?: string;
  colorIcon?: boolean;
  /** The entity the label names; the header renames it in place when its
   * file menu offers Rename. */
  id?: string;
}) {
  const panel = useSplitPanelOrThrow();
  useSplitDisplayName(() => props.label);
  const openTitleFileMenu = (e: MouseEvent) => {
    if (!isTouchDevice()) return;
    const trigger = panel.titleFileMenuTrigger();
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    trigger();
  };
  return (
    <SplitLabelContextMenu>
      <HeaderIsland class="shrink" onClick={openTitleFileMenu}>
        <div
          class={cn(
            'z-split-header-content relative flex items-center gap-1.5 max-w-full h-full shrink',
            props.class
          )}
        >
          <Show when={props.iconType}>
            <EntityIcon
              class="shrink-0"
              targetType={props.iconType}
              size="xs"
              theme={props.colorIcon ? undefined : 'monochrome'}
            />
          </Show>
          <Show when={props.icon}>
            <div class="flex shrink-0 items-center justify-center">
              {props.icon}
            </div>
          </Show>
          <Show when={props.badges}>{props.badges}</Show>
          <span class="inline-flex min-w-0 items-center gap-1">
            <SplitTitleName panel={panel} id={props.id} label={props.label} />
            <Show when={panel.titleFileMenuTrigger()}>
              <CaretDownIcon class="hidden size-3.5 shrink-0 text-ink-muted touch:block" />
            </Show>
          </span>
          <div
            class="shrink-0 flex items-center h-full"
            ref={titleFileMenuMount(panel)}
          />
        </div>
      </HeaderIsland>
    </SplitLabelContextMenu>
  );
}

export function SplitLabel(props: {
  label: string;
  /** The entity the label names; see {@link StaticSplitLabel}. */
  id?: string;
  lockRename?: boolean;
  maxDisplayLength?: number;
}) {
  const panel = useSplitPanelOrThrow();

  useSplitDisplayName(() => props.label);

  const truncatedLabel = () => {
    if (!props.maxDisplayLength) return props.label;
    if (props.label.length <= props.maxDisplayLength) return props.label;
    return props.label.slice(0, props.maxDisplayLength - 3) + '...';
  };

  const openTitleFileMenu = (e: MouseEvent) => {
    if (!isTouchDevice()) return;
    const trigger = panel.titleFileMenuTrigger();
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    trigger();
  };

  return (
    <span class="flex min-w-0 items-center gap-1" onClick={openTitleFileMenu}>
      <SplitTitleName
        panel={panel}
        id={props.lockRename ? undefined : props.id}
        label={props.label}
      >
        {truncatedLabel()}
      </SplitTitleName>
      <Show when={panel.titleFileMenuTrigger()}>
        <CaretDownIcon class="hidden size-4 shrink-0 text-ink-muted touch:block" />
      </Show>
    </span>
  );
}

export function SplitHeaderBadge(props: { text: string; tooltip?: string }) {
  return (
    <span class="py-0.5 px-2 rounded-none text-xxs text-ink-muted">
      <Tooltip label={props.tooltip ?? ''} as="span">
        <span class="font-mono uppercase">{props.text}</span>
      </Tooltip>
    </span>
  );
}

export function SplitPermissionsBadge() {
  const canEdit = useCanEdit();
  const canComment = useCanComment();
  const canView = useCanView();
  const showBadge = () => !canEdit();

  const tooltip = () => {
    if (!canView()) return t('splitMenu.noAccess');
    if (canComment()) return t('splitMenu.commentOnly');
    return t('splitMenu.viewOnly');
  };

  const text = () => {
    if (!canView()) return t('splitMenu.badgeNoAccess');
    if (canComment()) return t('splitMenu.badgeCommentOnly');
    return t('splitMenu.badgeViewer');
  };

  return (
    <Show when={showBadge()}>
      <SplitHeaderBadge text={text()} tooltip={tooltip()} />
    </Show>
  );
}

export function BlockItemSplitLabel(props: {
  /**
   * The entity the label names, when it is not the block's own. Its header's
   * registered rename decides who may rename it, not document ownership.
   */
  id?: string;
  icon?: JSX.Element;
  fallbackName?: string;
  name?: Accessor<string | undefined>;
  lockRename?: boolean;
  badges?: JSX.Element;
  /** Rendered after the file name. */
  trailingBadges?: JSX.Element;
  /** Replaces the static name, e.g. with an inline title editor. */
  title?: JSX.Element;
}) {
  const panel = useSplitPanelOrThrow();
  if (!isInBlock())
    throw new Error('<BlockItemSplitLabel> must be used within a Block');

  const ownBlockId = useBlockId();
  const blockId = () => props.id ?? ownBlockId;
  const fileName = useBlockDocumentName(props.fallbackName);
  const displayName = () => props.name?.() ?? fileName();
  const blockName = useBlockAliasedName();
  const isOwner = useIsDocumentOwner();
  const lockRename = () =>
    (props.id === undefined && !isOwner()) || props.lockRename;

  const targetType = () => {
    if (blockName === 'unknown') {
      return blockMetadataSignal()?.fileType ?? blockName;
    }
    return blockName;
  };

  useSplitDisplayName(displayName);

  const openTitleFileMenu = (e: MouseEvent) => {
    if (!isTouchDevice()) return;
    const trigger = panel.titleFileMenuTrigger();
    if (!trigger) return;
    e.preventDefault();
    e.stopPropagation();
    trigger();
  };

  return (
    <SplitLabelContextMenu>
      <HeaderIsland class="shrink" onClick={openTitleFileMenu}>
        <div class="ph-no-capture z-split-header-content relative flex items-center gap-2 min-w-0 max-w-full h-full shrink">
          <Show
            when={props.icon}
            fallback={
              <EntityIcon
                class="shrink-0"
                targetType={targetType()}
                size="xs"
              />
            }
          >
            {props.icon}
          </Show>
          <Show when={props.badges}>{props.badges}</Show>
          <Show
            when={props.title}
            fallback={
              <Show
                when={blockMetadataSignal()}
                fallback={
                  <SplitLabel
                    id={blockId()}
                    label={displayName() ?? ''}
                    lockRename={lockRename()}
                  />
                }
              >
                {(metadata) => (
                  <DocumentTitleHoverCard
                    documentId={metadata().documentId}
                    name={displayName() ?? ''}
                    ownerId={metadata().owner}
                    createdAt={metadata().createdAt}
                    updatedAt={metadata().updatedAt}
                  >
                    <SplitLabel
                      id={blockId()}
                      label={displayName() ?? ''}
                      lockRename={lockRename()}
                    />
                  </DocumentTitleHoverCard>
                )}
              </Show>
            }
          >
            {(title) => title()}
          </Show>
          {props.trailingBadges}
          <div
            class="shrink-0 flex items-center h-full"
            ref={titleFileMenuMount(panel)}
          />
        </div>
      </HeaderIsland>
    </SplitLabelContextMenu>
  );
}

function SplitLabelContextMenu(props: ParentProps) {
  const panel = useSplitPanelOrThrow();
  const actions = () => panel.titleFileMenuActions();
  const sections = createMemo(() => {
    const groups = actions();
    return groups ? getSplitFileMenuActionSections(groups) : [];
  });
  const hasActions = createMemo(() => sections().length > 0);
  let afterClose: (() => void) | undefined;

  const item = (action: SplitFileMenuAction) => {
    const children = () => action.children?.filter(Boolean) ?? [];

    return (
      <Show
        when={children().length > 0}
        fallback={
          <MenuItem
            icon={action.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>}
            text={action.label}
            hotkeyToken={action.hotkeyToken}
            onClick={() => {
              if (action.afterMenuCloses) afterClose = () => action.action?.();
              else action.action?.();
            }}
          />
        }
      >
        <ContextMenu.Sub>
          <SubTrigger
            icon={action.icon as Component<JSX.SvgSVGAttributes<SVGSVGElement>>}
            text={action.label}
          />
          <ContextMenuContent submenu class="w-64">
            <For each={children()}>{item}</For>
          </ContextMenuContent>
        </ContextMenu.Sub>
      </Show>
    );
  };

  const openOnDoubleClick = (e: MouseEvent) => {
    if (!hasActions()) return;
    const target = e.currentTarget;
    if (!target) return;
    e.preventDefault();
    e.stopPropagation();
    target.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        button: 2,
      })
    );
  };

  return (
    <Show when={hasActions()} fallback={props.children}>
      <ContextMenu>
        <ContextMenu.Trigger class="contents" onDblClick={openOnDoubleClick}>
          {props.children}
        </ContextMenu.Trigger>
        <ContextMenu.Portal>
          <ContextMenuContent
            class="w-64"
            onCloseAutoFocus={() => {
              const run = afterClose;
              if (!run) return;
              afterClose = undefined;
              queueMicrotask(run);
            }}
          >
            <For each={sections()}>
              {(section, index) => (
                <>
                  <Show when={index() > 0}>
                    <MenuSeparator />
                  </Show>
                  <For each={section.actions}>{item}</For>
                </>
              )}
            </For>
          </ContextMenuContent>
        </ContextMenu.Portal>
      </ContextMenu>
    </Show>
  );
}

/**
 * A ref that makes its element the split title's file menu mount until the
 * element's owner is disposed. The split outlives the views in it, so a mount
 * left behind would keep a view that has gone alive.
 */
export function titleFileMenuMount(
  panel: Pick<SplitPanelContextType, 'setTitleFileMenuRef'>
) {
  return (element: HTMLDivElement) => {
    panel.setTitleFileMenuRef(element);
    onCleanup(() =>
      panel.setTitleFileMenuRef((current) =>
        current === element ? undefined : current
      )
    );
  };
}

export function SplitTitleFileMenu(props: ParentProps) {
  const panel = useSplitPanelOrThrow();

  return (
    <Show when={panel.titleFileMenuRef()}>
      <Portal
        mount={panel.titleFileMenuRef()}
        ref={(div) => {
          div.style.display = 'contents';
        }}
      >
        {props.children}
      </Portal>
    </Show>
  );
}
