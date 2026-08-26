import { DOCS_BASE } from '@app/constants/docs-links';
import { CommandState } from '@app/features/command';
import {
  deleteEmailDraftThroughComposer,
  trackedEmailDrafts,
  untrackEmailDraft,
} from '@app/features/block-email/draft-tracker';
import {
  cleanupTaskDraftThroughComposer,
  clearTaskComposerDraft,
  loadTaskComposerDraft,
  trackedTaskComposerDraft,
} from '@app/features/block-md/util/taskComposerStorage';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useHotkeyInterceptor } from '@app/signal/hotkeyRoot';
import { globalSplitManager } from '@app/signal/splitLayout';
import type { EmailComposeMeta } from '@components/app/split-layout/componentRegistry';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { SplitHandle } from '@components/app/split-layout/layoutManager';
import CircleBoldIcon from '@phosphor-icons/core/bold/circle-bold.svg?component-solid';
import CircleNotchIcon from '@phosphor/circle-notch.svg';
import CommandIcon from '@phosphor/command.svg';
import EnvelopeIcon from '@phosphor/envelope-simple.svg';
import LaptopIcon from '@phosphor/laptop.svg';
import QuestionIcon from '@phosphor/question.svg';
import TrashIcon from '@phosphor/trash.svg';
import { useDeleteDraftMutation } from '@queries/email/draft';
import { Button, cn, Dropdown } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from 'solid-js';
import {
  mockAgentLoading,
  mockAgentNotification,
  setMockAgentNotification,
} from './experimental-debug-state';
import { ExperimentalQuickAgentChat } from './experimental-quick-agent-chat';

type DraftBarItem = {
  draftId: string;
  label: string;
  threadId?: string;
  linkId?: string;
  handle?: SplitHandle;
};

/** Thin global utility and draft shelf used by Experimental v6. */
export function ExperimentalGlobalBottomBar() {
  const analytics = useAnalytics();
  const layout = useSplitLayout();
  const deleteEmailDraftMutation = useDeleteDraftMutation();
  const [emailDraftMenuOpen, setEmailDraftMenuOpen] = createSignal(false);
  const [quickAgentMounted, setQuickAgentMounted] = createSignal(false);
  const [quickAgentOpen, setQuickAgentOpen] = createSignal(false);
  const [quickAgentGenerating, setQuickAgentGenerating] = createSignal(false);
  const [quickAgentUnread, setQuickAgentUnread] = createSignal(false);
  let wasQuickAgentGenerating = false;
  const quickAgentLoading = () =>
    mockAgentLoading() || quickAgentGenerating();
  let quickAgentPopoverRef: HTMLDivElement | undefined;

  onMount(() => {
    loadTaskComposerDraft();
  });

  const drafts = createMemo<DraftBarItem[]>(() => {
    const manager = globalSplitManager();
    if (!manager) return [];

    const openDrafts = new Map<string, SplitHandle>();
    for (const split of manager.splits()) {
      if (
        split.content.type !== 'component' ||
        split.content.id !== 'email-compose'
      ) {
        continue;
      }
      const handle = manager.getSplit(split.id);
      const meta = handle?.meta() as EmailComposeMeta | undefined;
      if (!handle || meta?.kind !== 'email-compose' || !meta.hasDraft) continue;
      if (!meta.draftId || openDrafts.has(meta.draftId)) continue;
      openDrafts.set(meta.draftId, handle);
    }
    return trackedEmailDrafts().map((draft) => ({
      draftId: draft.id,
      label: draft.label,
      threadId: draft.threadId,
      linkId: draft.linkId,
      handle: openDrafts.get(draft.id),
    }));
  });

  createEffect(() => {
    if (emailDraftMenuOpen() && drafts().length === 0) {
      setEmailDraftMenuOpen(false);
    }
  });

  const toggleQuickAgent = () => {
    const willOpen = !quickAgentOpen();
    setQuickAgentMounted(true);
    setQuickAgentOpen(willOpen);
    if (willOpen) {
      setQuickAgentUnread(false);
      setMockAgentNotification(false);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const focusTarget = quickAgentPopoverRef?.querySelector<HTMLElement>(
            '#chat-input-text-area, textarea, input, [contenteditable="true"]'
          );
          focusTarget?.focus();
        });
      });
    }
  };

  const handleQuickAgentGeneratingChange = (generating: boolean) => {
    if (
      wasQuickAgentGenerating &&
      !generating &&
      !quickAgentOpen()
    ) {
      setQuickAgentUnread(true);
    }
    wasQuickAgentGenerating = generating;
    setQuickAgentGenerating(generating);
  };

  const closeQuickAgent = () => {
    wasQuickAgentGenerating = false;
    setQuickAgentGenerating(false);
    setQuickAgentUnread(false);
    setQuickAgentOpen(false);
    setQuickAgentMounted(false);
  };

  useHotkeyInterceptor((context) => {
    if (
      context.eventType !== 'keydown' ||
      context.pressedKeysString !== 'cmd+j'
    ) {
      return false;
    }
    toggleQuickAgent();
    return true;
  });

  const openCommandMenu = () => {
    analytics.track('command_menu_open', { from: 'v6_bottom_bar' });
    CommandState.open();
  };

  const revisitDraft = (draft: DraftBarItem) => {
    if (draft.handle) {
      draft.handle.activate();
      globalSplitManager()?.returnFocus();
      return;
    }
    // A standalone compose cannot hydrate an existing draft without its email
    // thread context. Reopen the thread that owns this exact draft instead of
    // falling back to a blank compose.
    if (!draft.threadId) return;
    layout.openWithSplit(
      { type: 'email', id: draft.threadId },
      {
        preferNewSplit: true,
        allowDuplicate: false,
        mergeHistory: false,
        referredFrom: 'quick-access',
      }
    );
  };

  const deleteEmailDraft = async (draft: DraftBarItem) => {
    try {
      const handledByComposer = await deleteEmailDraftThroughComposer(
        draft.draftId
      );
      if (!handledByComposer) {
        await deleteEmailDraftMutation.mutateAsync({
          draftId: draft.draftId,
          threadId: draft.threadId,
          linkId: draft.linkId,
        });
      }
    } catch {
      return;
    }
    draft.handle?.close();
    untrackEmailDraft(draft.draftId);
  };

  const revisitTaskDraft = () => {
    const existing = globalSplitManager()
      ?.getActivePopovers()
      .find(
        (popover) =>
          popover.content().type === 'component' &&
          popover.content().id === 'task-compose'
      );
    if (existing) return;
    layout.popoverSplit({ type: 'component', id: 'task-compose' });
  };

  const deleteTaskDraft = () => {
    if (cleanupTaskDraftThroughComposer()) return;
    const manager = globalSplitManager();
    manager?.getActivePopovers().forEach((popover) => {
      const content = popover.content();
      if (content.type === 'component' && content.id === 'task-compose') {
        popover.close();
      }
    });
    clearTaskComposerDraft();
  };

  return (
    <footer class="flex shrink-0 items-center gap-2 bg-page px-2 py-1 text-xs">
      <Button
        variant="ghost"
        size="icon-sm"
        class="size-7 shrink-0 rounded-lg text-ink-muted"
        label="Help"
        tooltipPlacement="top"
        aria-label="Help"
        onClick={() =>
          window.open(DOCS_BASE, '_blank', 'noopener,noreferrer')
        }
      >
        <QuestionIcon class="size-3.5" />
      </Button>

      <div class="min-w-0 flex-1" />

      <div class="ml-auto flex shrink-0 items-center gap-1">
        <Show when={trackedTaskComposerDraft()}>
          {(draft) => (
            <div class="relative grid h-7 max-w-52 text-ink-muted">
              <button
                type="button"
                class="flex h-full min-w-0 items-center gap-1.5 rounded-lg py-0 pl-2 pr-9 text-[11px] hover:bg-hover hover:text-ink"
                title={draft().title || 'Task draft'}
                onClick={revisitTaskDraft}
              >
                <CircleBoldIcon class="size-3.5 shrink-0" />
                <span class="truncate">{draft().title || 'Task draft'}</span>
              </button>
              <button
                type="button"
                class="absolute right-0 top-0 flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-extra-muted hover:bg-failure/25 hover:text-failure focus-visible:bg-failure/25 focus-visible:text-failure"
                aria-label="Delete task draft"
                onClick={deleteTaskDraft}
              >
                <TrashIcon class="size-3.5" />
              </button>
            </div>
          )}
        </Show>

        <Show
          when={
            drafts().length === 1 && !emailDraftMenuOpen()
              ? drafts()[0]
              : undefined
          }
        >
          {(draft) => (
            <div class="relative grid h-7 max-w-56 text-ink-muted">
              <button
                type="button"
                class="flex h-full min-w-0 items-center gap-1.5 rounded-lg py-0 pl-2 pr-9 text-[11px] hover:bg-hover hover:text-ink"
                title={draft().label}
                onClick={() => revisitDraft(draft())}
              >
                <EnvelopeIcon class="size-3.5 shrink-0" />
                <span class="truncate">{draft().label}</span>
              </button>
              <button
                type="button"
                class="absolute right-0 top-0 flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-extra-muted hover:bg-failure/25 hover:text-failure focus-visible:bg-failure/25 focus-visible:text-failure"
                aria-label={`Delete ${draft().label}`}
                onClick={() => void deleteEmailDraft(draft())}
              >
                <TrashIcon class="size-3.5" />
              </button>
            </div>
          )}
        </Show>

        <Show
          when={
            drafts().length > 0 &&
            (drafts().length > 1 || emailDraftMenuOpen())
          }
        >
          <Dropdown
            open={emailDraftMenuOpen()}
            onOpenChange={setEmailDraftMenuOpen}
            placement="top-end"
            gutter={6}
          >
            <Dropdown.Trigger
              variant="ghost"
              size="sm"
              class="h-7 gap-1.5 rounded-lg px-2 text-[11px] text-ink-muted"
              label={
                drafts().length === 1
                  ? '1 email draft'
                  : `${drafts().length} email drafts`
              }
              tooltipPlacement="top"
            >
              <EnvelopeIcon class="size-3.5" />
              <span>
                {drafts().length === 1
                  ? '1 email draft'
                  : `${drafts().length} email drafts`}
              </span>
            </Dropdown.Trigger>
            <Dropdown.Content class="min-w-64 shadow-menu">
              <Dropdown.Group>
                <For each={drafts()}>
                  {(draft) => (
                    <div class="relative min-w-0">
                      <Dropdown.Item
                        class="w-full min-w-0 gap-2 py-2 pl-2.5 pr-10 text-sm"
                        onSelect={() => revisitDraft(draft)}
                      >
                        <EnvelopeIcon class="size-3.5 shrink-0 text-ink-muted" />
                        <span class="min-w-0 flex-1 truncate text-ink">
                          {draft.label}
                        </span>
                      </Dropdown.Item>
                      <Dropdown.Item
                        class="absolute right-1 top-1/2 size-7 -translate-y-1/2 justify-center rounded-md p-0 text-ink-extra-muted hover:bg-failure/25 hover:text-failure data-highlighted:bg-failure/25 data-highlighted:text-failure"
                        aria-label={`Delete ${draft.label}`}
                        closeOnSelect={false}
                        onSelect={() => void deleteEmailDraft(draft)}
                      >
                        <TrashIcon class="size-3.5" />
                      </Dropdown.Item>
                    </div>
                  )}
                </For>
              </Dropdown.Group>
            </Dropdown.Content>
          </Dropdown>
        </Show>

        <Show
          when={trackedTaskComposerDraft() || drafts().length > 0}
        >
          <span
            aria-hidden="true"
            class="mx-1 h-4 w-px shrink-0 bg-edge-muted"
          />
        </Show>
        <div class="relative">
          <Show when={quickAgentMounted()}>
            <div
              ref={quickAgentPopoverRef}
              class={cn(
                'absolute bottom-[calc(100%+6px)] right-0 z-action-menu',
                !quickAgentOpen() && 'hidden'
              )}
            >
              <ExperimentalQuickAgentChat
                onMinimize={() => setQuickAgentOpen(false)}
                onClose={closeQuickAgent}
                onGeneratingChange={handleQuickAgentGeneratingChange}
              />
            </div>
          </Show>
          <Button
            variant="ghost"
            size="icon-sm"
            class={cn(
              'relative size-7 rounded-lg text-ink-muted',
              quickAgentOpen() && 'bg-active text-ink'
            )}
            label="Quick agent"
            shortcut="cmd+j"
            tooltipPlacement="top"
            aria-label="Quick agent"
            aria-expanded={quickAgentOpen()}
            aria-busy={quickAgentLoading()}
            onClick={toggleQuickAgent}
          >
            <Show
              when={!quickAgentLoading()}
              fallback={<CircleNotchIcon class="size-3.5 animate-spin" />}
            >
              <LaptopIcon class="size-3.5" />
            </Show>
            <Show
              when={
                !quickAgentOpen() &&
                !quickAgentLoading() &&
                (mockAgentNotification() || quickAgentUnread())
              }
            >
              <span class="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-accent ring-2 ring-page" />
            </Show>
          </Button>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          class="size-7 rounded-lg text-ink-muted"
          label="Command menu"
          shortcut="cmd+k"
          tooltipPlacement="top"
          aria-label="Command menu"
          onClick={openCommandMenu}
        >
          <CommandIcon class="size-3.5" />
        </Button>
      </div>
    </footer>
  );
}
