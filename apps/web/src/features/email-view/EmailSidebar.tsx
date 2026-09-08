import { runCreateAction } from '@app/features/command/Launcher';
import { ViewFavorites } from '@app/features/favorites/view-favorites';
import { useSoupView } from '@app/features/next-soup/soup-view/soup-view-context';
import { useApplyPreset } from '@app/features/next-soup/soup-view/soup-view-tabs';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableMultiInbox } from '@core/constant/featureFlags';
import { useAddInboxFlow } from '@core/email-link';
import CalendarIcon from '@phosphor/calendar-blank.svg';
import CaretDownIcon from '@phosphor/caret-down.svg';
import CheckIcon from '@phosphor/check.svg';
import EnvelopeIcon from '@phosphor/envelope.svg';
import FileIcon from '@phosphor/file-text.svg';
import PaperPlaneIcon from '@phosphor/paper-plane-tilt.svg';
import PencilIcon from '@phosphor/pencil-simple.svg';
import PlusIcon from '@phosphor/plus.svg';
import StackIcon from '@phosphor/stack.svg';
import TagIcon from '@phosphor/tag.svg';
import TrayIcon from '@phosphor/tray.svg';
import UsersIcon from '@phosphor/users.svg';
import { TagEditorDialog } from '@property/tags/TagEditorDialog';
import { useEmailLinksQuery } from '@queries/email/link';
import { useCurrentTeamQuery } from '@queries/team/teams';
import { Button, cn, Dropdown } from '@ui';
import { createSignal, createUniqueId, For, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

const MAILBOX_GROUPS = [
  {
    label: 'Inbox',
    items: [
      { id: 'important', label: 'Signal', icon: TrayIcon },
      { id: 'noise', label: 'Noise', icon: StackIcon },
    ],
  },
  {
    label: 'Mail',
    items: [
      { id: 'drafts', label: 'Drafts', icon: FileIcon },
      { id: 'sent', label: 'Sent', icon: PaperPlaneIcon },
      { id: 'all', label: 'All mail', icon: EnvelopeIcon },
    ],
  },
  {
    label: 'Views',
    items: [
      { id: 'calendar', label: 'Calendar', icon: CalendarIcon },
      { id: 'shared', label: 'Shared with me', icon: UsersIcon },
    ],
  },
];

export function EmailInboxSelector() {
  const view = useSoupView();
  const linksQuery = useEmailLinksQuery();
  const addInbox = useAddInboxFlow();
  const multiInbox = useFeatureFlag(enableMultiInbox);
  const links = () => (linksQuery.isSuccess ? linksQuery.data.links : []);
  const label = () => {
    const ids = view.inboxFilter();
    if (!ids) return 'All inboxes';
    if (ids.length === 1)
      return (
        links().find((link) => link.id === ids[0])?.email_address ??
        'Selected inbox'
      );
    return `${ids.length} inboxes`;
  };

  return (
    <Dropdown placement="bottom-start" gutter={6}>
      <Dropdown.Trigger
        as={Button}
        variant="ghost"
        size="md"
        class="h-11 w-full justify-start gap-3 rounded-xl border-edge-muted bg-ink/3 px-3"
        aria-label={`Choose inbox: ${label()}`}
      >
        <TrayIcon class="size-4 shrink-0 text-ink-muted" />
        <span class="min-w-0 flex-1 truncate text-left text-sm text-ink">
          {label()}
        </span>
        <CaretDownIcon class="size-3 text-ink-muted" />
      </Dropdown.Trigger>
      <Dropdown.Content class="w-72 rounded-xl">
        <Dropdown.Group>
          <Dropdown.RadioGroup
            value={
              view.inboxFilter()?.length === 1
                ? view.inboxFilter()![0]
                : view.inboxFilter()
                  ? ''
                  : 'all'
            }
            onChange={(id) =>
              view.setInboxFilter(id === 'all' ? undefined : [id])
            }
          >
            <Dropdown.RadioItem value="all" class="gap-3 py-2">
              <TrayIcon class="size-4" />
              <span class="flex-1">All inboxes</span>
              <Dropdown.ItemIndicator>
                <CheckIcon class="size-4" />
              </Dropdown.ItemIndicator>
            </Dropdown.RadioItem>
            <For each={links()}>
              {(link) => (
                <Dropdown.RadioItem value={link.id} class="gap-3 py-2">
                  <EnvelopeIcon class="size-4 shrink-0 text-ink-muted" />
                  <span class="min-w-0 flex-1 truncate">
                    {link.email_address}
                  </span>
                  <Dropdown.ItemIndicator>
                    <CheckIcon class="size-4" />
                  </Dropdown.ItemIndicator>
                </Dropdown.RadioItem>
              )}
            </For>
          </Dropdown.RadioGroup>
          <Show when={linksQuery.isPending}>
            <div class="px-3 py-2 text-sm text-ink-muted">Loading inboxes…</div>
          </Show>
          <Show when={linksQuery.isError}>
            <div class="px-3 py-2 text-sm text-ink-muted">
              Could not load inboxes
            </div>
          </Show>
          <Show
            when={
              multiInbox().enabled ||
              (linksQuery.isSuccess && links().length === 0)
            }
          >
            <Dropdown.Item
              onSelect={() => addInbox()}
              class="mt-1 border-t border-edge-muted py-2"
            >
              Connect an inbox
            </Dropdown.Item>
          </Show>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}

function EmailSidebarSection(props: {
  label: string;
  collapsible?: boolean;
  action?: JSX.Element;
  children: JSX.Element;
}) {
  const [expanded, setExpanded] = createSignal(true);
  const contentId = createUniqueId();
  return (
    <section aria-label={props.label}>
      <h2 class="mb-1 flex items-center text-xs font-medium text-ink-subtle">
        <Show
          when={props.collapsible}
          fallback={<span class="px-3">{props.label}</span>}
        >
          <button
            type="button"
            class="flex min-w-0 flex-1 items-center gap-2 rounded-md px-3 py-1 text-left hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
            aria-expanded={expanded()}
            aria-controls={contentId}
            onClick={() => setExpanded((value) => !value)}
          >
            <CaretDownIcon
              class={cn('size-3 shrink-0', !expanded() && '-rotate-90')}
            />
            {props.label}
          </button>
        </Show>
        {props.action}
      </h2>
      <div id={contentId} hidden={props.collapsible && !expanded()}>
        {props.children}
      </div>
    </section>
  );
}

/** Mailbox navigation shares the existing email presets and account filter. */
export function EmailSidebar() {
  const view = useSoupView();
  const { applyTabPreset } = useApplyPreset();
  const tags = view.tagFilter;
  const [creatingTag, setCreatingTag] = createSignal(false);
  const teamQuery = useCurrentTeamQuery();
  const mailboxActive = (id: string) =>
    tags.activeIds().length === 0 && (view.activeTab() ?? 'important') === id;
  return (
    <aside
      aria-label="Email navigation"
      class="flex size-full min-h-0 flex-col border-r border-edge-muted bg-sidebar"
    >
      <header class="flex h-12 shrink-0 items-center border-b border-edge-muted px-5">
        <h1 class="text-xl font-semibold tracking-tight text-ink">Email</h1>
      </header>
      <div class="flex min-h-0 flex-1 flex-col overflow-y-auto px-3 py-4">
        <EmailInboxSelector />
        <Button
          variant="ghost"
          class="mt-3 h-10 justify-start gap-3 rounded-xl border-edge-muted bg-ink/4 px-3 text-ink"
          onClick={() => runCreateAction('email', { source: 'sidebar' })}
        >
          <PencilIcon class="size-4" />
          Compose
        </Button>
        <nav aria-label="Mailboxes" class="mt-6 flex flex-col gap-6">
          <For each={MAILBOX_GROUPS}>
            {(group) => (
              <>
                <EmailSidebarSection
                  label={group.label}
                  collapsible={group.label !== 'Inbox'}
                >
                  <div class="flex flex-col gap-0.5">
                    <For each={group.items}>
                      {(item) => (
                        <Button
                          variant="ghost"
                          class={cn(
                            'h-9 justify-start gap-3 rounded-xl px-3 font-normal',
                            mailboxActive(item.id) && 'bg-active text-ink'
                          )}
                          aria-current={
                            mailboxActive(item.id) ? 'page' : undefined
                          }
                          onClick={() => applyTabPreset('mail', item.id)}
                        >
                          <Dynamic component={item.icon} class="size-4" />
                          {item.label}
                        </Button>
                      )}
                    </For>
                  </div>
                </EmailSidebarSection>
                <Show when={group.label === 'Views'}>
                  <ViewFavorites view="mail" />
                </Show>
              </>
            )}
          </For>
          <EmailSidebarSection
            label="Tags"
            collapsible
            action={
              <Button
                variant="ghost"
                size="icon-sm"
                class="mr-2 text-ink-muted"
                aria-label="Create tag"
                tooltip="Create tag"
                onClick={() => setCreatingTag(true)}
              >
                <PlusIcon class="size-3.5" />
              </Button>
            }
          >
            <div class="flex flex-col gap-0.5">
              <For each={tags.options()}>
                {(tag) => (
                  <Button
                    variant="ghost"
                    class={cn(
                      'h-9 shrink-0 justify-start gap-3 rounded-xl px-3 font-normal',
                      tags.activeIds().includes(tag.id) && 'bg-active text-ink'
                    )}
                    aria-pressed={tags.activeIds().includes(tag.id)}
                    onClick={() => {
                      const selected = tags.activeIds().includes(tag.id);
                      applyTabPreset('mail', 'all');
                      tags.onChange(selected ? [] : [tag.id]);
                    }}
                  >
                    <span class="flex size-4 shrink-0 items-center justify-center">
                      <Show
                        when={tag.icon}
                        fallback={<TagIcon class="size-4" />}
                      >
                        {(icon) => icon()()}
                      </Show>
                    </span>
                    <span class="truncate">{tag.label}</span>
                  </Button>
                )}
              </For>
            </div>
          </EmailSidebarSection>
        </nav>
      </div>
      <TagEditorDialog
        open={creatingTag()}
        mode={{ type: 'create', initialScope: 'user' }}
        teamAvailable={teamQuery.isSuccess && Boolean(teamQuery.data?.team)}
        onClose={() => setCreatingTag(false)}
      />
    </aside>
  );
}
