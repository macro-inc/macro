import type { CreateFolderDropTarget } from '@app/features/next-soup/actions';
import { t } from '@app/lib/i18n';
import ArrowUpIcon from '@icon/system/regular/arrow-up.svg';
import CaretRightIcon from '@icon/system/regular/caret-right.svg';
import DotsIcon from '@icon/system/regular/dots-three.svg';
import FolderIcon from '@icon/system/regular/folder.svg';
import { Button, cn, Dropdown, Tooltip } from '@ui';
import { For, type JSX, Show } from 'solid-js';
import { collapseBreadcrumbs } from '../../core/drive-columns';

export type RedesignBreadcrumbSegment = {
  id: string;
  label: string;
  /** `null` for My Drive root, folder ID for folders, `undefined` for non-folder targets. */
  folderId: string | null | undefined;
  onSelect: () => void;
};

function DropSegment(props: {
  segment: RedesignBreadcrumbSegment;
  isActive: boolean;
  createDropTarget?: CreateFolderDropTarget;
}) {
  const dropTarget = props.createDropTarget?.(() =>
    props.isActive ? undefined : props.segment.folderId
  );

  return (
    <div
      ref={(element) => dropTarget?.ref(element)}
      class={cn(
        'flex min-w-0 items-center rounded-lg transition-colors',
        dropTarget?.isOver() && 'bg-accent/12 ring-2 ring-inset ring-accent'
      )}
    >
      <Tooltip label={props.segment.label} class="min-w-0 max-w-full">
        <button
          type="button"
          aria-current={props.isActive ? 'page' : undefined}
          class={cn(
            'inline-flex h-7 max-w-44 min-w-0 items-center gap-1.5 rounded-lg px-2 text-sm transition-colors outline-none focus-visible:outline-2 focus-visible:outline-accent',
            props.isActive
              ? 'font-semibold tracking-[-0.02em] text-ink hover:bg-hover'
              : 'font-medium text-ink-muted hover:bg-hover hover:text-ink'
          )}
          onClick={props.segment.onSelect}
        >
          <span class="truncate">{props.segment.label}</span>
        </button>
      </Tooltip>
    </div>
  );
}

/**
 * Interactive Finder/Google Drive breadcrumb bar: every ancestor segment
 * accepts drag-and-drop moves up the hierarchy, deep trails collapse middle
 * segments into an accessible overflow dropdown, and an Up button steps up
 * one level.
 */
export function RedesignBreadcrumbs(props: {
  segments: readonly RedesignBreadcrumbSegment[];
  createDropTarget?: CreateFolderDropTarget;
  onNavigateUp?: () => void;
  parentLabel?: string;
  trailingMenu?: JSX.Element;
}) {
  const collapsed = () => collapseBreadcrumbs(props.segments, 4);

  return (
    <nav
      aria-label={t('drive.folders')}
      class="flex min-w-0 items-center gap-0.5"
    >
      <Show when={props.onNavigateUp}>
        {(onUp) => (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              props.parentLabel
                ? t('drive.backToParent', { name: props.parentLabel })
                : t('drive.goToParentFolder')
            }
            tooltip={
              props.parentLabel
                ? t('drive.backToParent', { name: props.parentLabel })
                : t('drive.goToParentFolder')
            }
            class="mr-0.5 shrink-0 text-ink-muted hover:text-ink"
            onClick={onUp()}
          >
            <ArrowUpIcon class="size-3.5" aria-hidden="true" />
          </Button>
        )}
      </Show>
      <For each={collapsed().leading}>
        {(segment, index) => {
          const isLast = () =>
            collapsed().hidden.length === 0 &&
            collapsed().trailing.length === 0 &&
            index() === collapsed().leading.length - 1;
          return (
            <div class="flex min-w-0 items-center gap-0.5">
              <Show when={index() > 0}>
                <CaretRightIcon
                  aria-hidden="true"
                  class="size-3 shrink-0 text-ink-subtle"
                />
              </Show>
              <DropSegment
                segment={segment}
                isActive={isLast()}
                createDropTarget={props.createDropTarget}
              />
            </div>
          );
        }}
      </For>
      <Show when={collapsed().hidden.length > 0}>
        <CaretRightIcon
          aria-hidden="true"
          class="size-3 shrink-0 text-ink-subtle"
        />
        <Dropdown placement="bottom-start">
          <Dropdown.Trigger
            as={Button}
            variant="ghost"
            size="icon-sm"
            aria-label={t('drive.moreAncestors')}
            tooltip={t('drive.moreAncestors')}
            class="shrink-0 text-ink-muted hover:text-ink"
          >
            <DotsIcon class="size-3.5" aria-hidden="true" />
          </Dropdown.Trigger>
          <Dropdown.Content class="min-w-44">
            <For each={collapsed().hidden}>
              {(segment) => (
                <Dropdown.Item onSelect={segment.onSelect}>
                  <FolderIcon
                    class="size-3.5 shrink-0 text-ink-muted"
                    aria-hidden="true"
                  />
                  <span class="truncate">{segment.label}</span>
                </Dropdown.Item>
              )}
            </For>
          </Dropdown.Content>
        </Dropdown>
      </Show>
      <For each={collapsed().trailing}>
        {(segment, index) => {
          const isLast = () => index() === collapsed().trailing.length - 1;
          return (
            <div class="flex min-w-0 items-center gap-0.5">
              <CaretRightIcon
                aria-hidden="true"
                class="size-3 shrink-0 text-ink-subtle"
              />
              <DropSegment
                segment={segment}
                isActive={isLast()}
                createDropTarget={props.createDropTarget}
              />
            </div>
          );
        }}
      </For>
      <Show when={props.trailingMenu}>
        <div class="ml-0.5 shrink-0">{props.trailingMenu}</div>
      </Show>
    </nav>
  );
}
