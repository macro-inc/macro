import { CollapsibleSection, ViewSidebar } from '@app/components/view-shell';
import { t } from '@app/lib/i18n';
import { inboxIconProps } from '@core/component/inboxIcon';
import { UserIcon } from '@core/component/UserIcon';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import { LabelIcon } from '@property/tags/LabelPill';
import type { InboxLabelEntry } from '@queries/email/label-names';
import { cn } from '@ui';
import { createMemo, createSignal, For, type JSX, Show } from 'solid-js';
import {
  type LabelTreeNode,
  type SidebarInboxLabels,
  sidebarLabels,
} from '../core/sidebar-labels';

/** The sidebar section id Mail stores the Labels section's place and state under. */
export const EMAIL_LABELS_SECTION_ID = 'labels';

type LabelRowsProps = {
  nodes: LabelTreeNode[];
  activeIds: readonly string[];
  isExpanded: (node: LabelTreeNode) => boolean;
  onToggle: (node: LabelTreeNode) => void;
  onSelect: (id: string) => void;
};

const holdsActive = (
  node: LabelTreeNode,
  activeIds: readonly string[]
): boolean =>
  activeIds.includes(node.id) ||
  node.children.some((child) => holdsActive(child, activeIds));

function LabelRows(props: LabelRowsProps) {
  return (
    <ul class="flex min-w-0 flex-col gap-(--sidebar-row-gap)">
      <For each={props.nodes}>
        {(node) => {
          const open = () => props.isExpanded(node);
          return (
            <li class="min-w-0">
              <ViewSidebar.TreeItem
                active={props.activeIds.includes(node.id)}
                expanded={node.children.length > 0 ? open() : undefined}
                label={node.fullName}
                onToggle={() => props.onToggle(node)}
                onClick={() => props.onSelect(node.id)}
              >
                <ViewSidebar.Icon>
                  <LabelIcon class="size-4" />
                </ViewSidebar.Icon>
                <span class="truncate">{node.name}</span>
              </ViewSidebar.TreeItem>
              <ViewSidebar.Branch open={open() && node.children.length > 0}>
                <LabelRows {...props} nodes={node.children} />
              </ViewSidebar.Branch>
            </li>
          );
        }}
      </For>
    </ul>
  );
}

/** A disclosure row that keeps the phone's sidebar sheet open. */
function ToggleRow(props: {
  open: boolean;
  onToggle: () => void;
  icon?: () => JSX.Element;
  label: string;
}) {
  return (
    <ViewSidebar.Item
      aria-expanded={props.open}
      onClick={(event) => {
        event.preventDefault();
        props.onToggle();
      }}
    >
      <Show when={props.icon}>
        {(icon) => <ViewSidebar.Icon>{icon()()}</ViewSidebar.Icon>}
      </Show>
      <span class="min-w-0 flex-1 truncate">{props.label}</span>
      <CaretDownIcon
        class={cn(
          'size-3 shrink-0 transition-transform touch:size-4',
          !props.open && '-rotate-90'
        )}
      />
    </ViewSidebar.Item>
  );
}

function InboxLabels(props: {
  inbox: SidebarInboxLabels;
  rows: Omit<LabelRowsProps, 'nodes'>;
}) {
  const [moreOpen, setMoreOpen] = createSignal<boolean>();
  const showsMore = () =>
    moreOpen() ??
    props.inbox.more.some((node) => holdsActive(node, props.rows.activeIds));
  return (
    <div class="flex min-w-0 flex-col gap-(--sidebar-row-gap)">
      <LabelRows {...props.rows} nodes={props.inbox.shown} />
      <Show when={props.inbox.more.length > 0}>
        <Show when={showsMore()}>
          <LabelRows {...props.rows} nodes={props.inbox.more} />
        </Show>
        <ViewSidebar.Item
          aria-expanded={showsMore()}
          onClick={(event) => {
            event.preventDefault();
            setMoreOpen(!showsMore());
          }}
        >
          <span class="truncate">
            {showsMore()
              ? t('common.showLess')
              : t('emailViews.moreLabels', { count: props.inbox.more.length })}
          </span>
        </ViewSidebar.Item>
      </Show>
    </div>
  );
}

/**
 * The Labels section of the Mail sidebar, drawn from the labels given: each
 * inbox's as a tree, under a row per inbox when `grouped`. Hidden while there
 * are none.
 */
export function EmailSidebarLabels(props: {
  /** The labels of the inboxes the account picker shows, in their order. */
  labels: readonly InboxLabelEntry[];
  /** Whether the account picker shows several inboxes. */
  grouped: boolean;
  addressOf: (linkId: string) => string;
  activeIds: readonly string[];
  onSelect: (id: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const inboxes = createMemo(() => sidebarLabels(props.labels));
  const addressOf = (linkId: string) => props.addressOf(linkId);

  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});
  const isExpanded = (node: LabelTreeNode) =>
    expanded()[node.id] ??
    node.children.some((child) => holdsActive(child, props.activeIds));
  const [closedInboxes, setClosedInboxes] = createSignal<readonly string[]>([]);
  const rows = {
    get activeIds() {
      return props.activeIds;
    },
    isExpanded,
    onToggle: (node: LabelTreeNode) =>
      setExpanded((current) => ({ ...current, [node.id]: !isExpanded(node) })),
    onSelect: (id: string) => props.onSelect(id),
  };

  return (
    <Show when={inboxes().length > 0}>
      <CollapsibleSection.Root
        sectionId={EMAIL_LABELS_SECTION_ID}
        sectionLabel={t('emailViews.labels')}
        open={props.open}
        onOpenChange={props.onOpenChange}
      >
        <CollapsibleSection.Header>
          <CollapsibleSection.Trigger class="flex-1">
            <span class="min-w-0 truncate">{t('emailViews.labels')}</span>
            <CollapsibleSection.Indicator />
          </CollapsibleSection.Trigger>
        </CollapsibleSection.Header>
        <CollapsibleSection.Content>
          <ViewSidebar.Nav aria-label={t('emailViews.labels')}>
            <Show
              when={props.grouped}
              fallback={<InboxLabels inbox={inboxes()[0]} rows={rows} />}
            >
              <ul class="flex min-w-0 flex-col gap-(--sidebar-row-gap)">
                <For each={inboxes()}>
                  {(inbox) => {
                    const open = () => !closedInboxes().includes(inbox.linkId);
                    const address = () => addressOf(inbox.linkId);
                    return (
                      <li class="min-w-0">
                        <ToggleRow
                          open={open()}
                          label={address()}
                          icon={() => (
                            <UserIcon
                              {...inboxIconProps(address())}
                              size="sm"
                              suppressClick
                              showTooltip={false}
                            />
                          )}
                          onToggle={() =>
                            setClosedInboxes((closed) =>
                              open()
                                ? [...closed, inbox.linkId]
                                : closed.filter((id) => id !== inbox.linkId)
                            )
                          }
                        />
                        <ViewSidebar.Branch open={open()}>
                          <InboxLabels inbox={inbox} rows={rows} />
                        </ViewSidebar.Branch>
                      </li>
                    );
                  }}
                </For>
              </ul>
            </Show>
          </ViewSidebar.Nav>
        </CollapsibleSection.Content>
      </CollapsibleSection.Root>
    </Show>
  );
}
