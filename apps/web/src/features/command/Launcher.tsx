import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { openStandaloneReminderComposer } from '@app/features/reminders/reminder-composer';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { setAutomationComposerOpen } from '@block-automation/component';
import { EMAIL_COMPOSE_TO_INPUT_ID } from '@block-email/constants';
import {
  endTrackedDocumentSpan,
  registerDocumentSpan,
  startDocumentSpan,
} from '@block-md/observability';
import { openNewChannelModal } from '@channel/CreateChannelModal';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { BlockAlias, BlockName } from '@core/block';
import { CHAT_INPUT_TEXT_AREA_ID } from '@core/component/AI/component/input/ChatInput';
import { getIconConfig } from '@core/component/EntityIcon';
import {
  ENABLE_ANIMATED_ICONS,
  enableChatV3Agents,
  enableReminders,
  enableSnippets,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { triggerFocusInput } from '@core/directive/focusInput';
import {
  createHotkeyGroup,
  registerHotkey,
  useHotkeyDOMScope,
} from '@core/hotkey/hotkeys';
import { pressedKeys } from '@core/hotkey/state';
import { TOKENS } from '@core/hotkey/tokens';
import type { ValidHotkey } from '@core/hotkey/types';
import { isMobile } from '@core/mobile/isMobile';
import {
  createCanvasFileFromJsonString,
  createChat,
  createCodeFileFromText,
  createMarkdownFile,
  createSnippet,
} from '@core/util/create';
import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';
import SkillIcon from '@icon/skill.svg';
import WideAutomation from '@icon/wide-automation.svg';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import WideChannel from '@icon/wide-channel.svg';
import { AnimatedChatIcon } from '@icon/wide-chat';
import WideChat from '@icon/wide-chat.svg';
import { AnimatedDiagramIcon } from '@icon/wide-diagram';
import WideDiagram from '@icon/wide-diagram.svg';
import { AnimatedEmailIcon } from '@icon/wide-email';
import WideEmail from '@icon/wide-email.svg';
import WideFileCode from '@icon/wide-file-code.svg';
import WideFileMd from '@icon/wide-file-md.svg';
import { AnimatedFileCodeIcon } from '@icon/wide-fileCode';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedFolderIcon } from '@icon/wide-folder';
import WideFolder from '@icon/wide-folder.svg';
import { AnimatedSnippetIcon } from '@icon/wide-snippet';
import WideSnippet from '@icon/wide-snippet.svg';
import { AnimatedStarIcon } from '@icon/wide-star';
import WideStar from '@icon/wide-star.svg';
import { AnimatedTaskIcon } from '@icon/wide-task';
import WideTask from '@icon/wide-task.svg';
import { Dialog } from '@kobalte/core/dialog';
import { getMarkdownGoldenBytes } from '@macro-inc/lexical-core/markdown-golden';
import type { Span } from '@macro-inc/observability';
import BellSimpleIcon from '@phosphor/bell-simple.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import Robot from '@phosphor/robot.svg';
import { createProject } from '@queries/storage/projects';
import { makePersisted } from '@solid-primitives/storage';
import {
  CommandMenuHotkeyHint,
  CommandMenuList,
  CommandMenuSearchInput,
  CommandMenuShell,
  cn,
  createCommandListController,
  Hotkey,
  ToggleSwitch,
} from '@ui';
import { getNormalizedKeyString } from '@ui/components/Hotkey';
import {
  type Accessor,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';
import type { CreatableBlock, CreatableName } from './types';

const LAUNCHER_FRECENCY_STORE = 'launcher-frecency-v1';
const LAUNCHER_SEARCH_MODE_STORE = 'launcher-search-mode-v1';
const FRECENCY_COUNT_WEIGHT = 10;
const FRECENCY_HALF_LIFE_DAYS = 14;

type LauncherFrecencyEntry = {
  count: number;
  lastUsedAt: number;
};

type LauncherFrecencyStore = Record<string, LauncherFrecencyEntry>;

const [launcherFrecencyStore, setLauncherFrecencyStore] = makePersisted(
  createStore<LauncherFrecencyStore>({}),
  { name: LAUNCHER_FRECENCY_STORE }
);
const [launcherSearchMode, setLauncherSearchModePreference] = makePersisted(
  createSignal(false),
  { name: LAUNCHER_SEARCH_MODE_STORE }
);

function launcherItemKey(item: CreatableBlock) {
  return String(item.hotkeyToken ?? `${item.label}:${item.hotkey}`);
}

function launcherFrecencyScore(item: CreatableBlock, now = Date.now()) {
  const entry = launcherFrecencyStore[launcherItemKey(item)];
  if (!entry) return 0;

  const ageMs = Math.max(now - entry.lastUsedAt, 0);
  const halfLifeMs = FRECENCY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;
  const recency = Math.pow(0.5, ageMs / halfLifeMs);

  return entry.count * FRECENCY_COUNT_WEIGHT + recency;
}

function trackLauncherItemUsage(item: CreatableBlock) {
  const key = launcherItemKey(item);
  const previous = launcherFrecencyStore[key];

  setLauncherFrecencyStore(key, {
    count: (previous?.count ?? 0) + 1,
    lastUsedAt: Date.now(),
  });
}

function matchesLauncherSearch(item: CreatableBlock, query: string) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (terms.length === 0) return true;

  const searchableText = [
    item.label,
    item.description,
    item.launcherHint,
    item.blockName,
    ...(item.keywords ?? []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return terms.every((term) => searchableText.includes(term));
}

const createBlock = async (spec: {
  blockName: BlockName | BlockAlias;
  createFn: () => Promise<string | undefined>;
  loading?: boolean;
  shouldInsert?: boolean;
  /** Active creation span; registered by document id after creation. */
  span?: Span;
}) => {
  const { openWithSplit } = useSplitLayout();
  const { blockName, createFn, loading, span } = spec;

  setCreateMenuOpen(false, false);

  // WORKAROUND: On mobile, the navigation interceptor in createMobileSwipeLayout
  // consumes openWithSplit calls and returns undefined instead of a SplitHandle.
  // This means we can't show a loading spinner then replace it via split.replace(),
  // because we never get a handle back. Instead, on mobile we skip the loading state
  // and navigate directly to the created block after the async creation completes.
  // If the mobile navigation interceptor is refactored to return handles, this
  // workaround can be removed and both paths can use the loading-then-replace flow.
  const showLoadingFirst = loading && !isMobile();

  const split = showLoadingFirst
    ? openWithSplit(
        { type: 'component', id: 'loading' },
        { referredFrom: 'launcher', preferNewSplit: spec.shouldInsert }
      )
    : undefined;

  const id = await createFn();
  if (!id) {
    span?.setAttr('error', true);
    span?.end();
    split?.goBack();
    return;
  }

  span?.setAttr('document.id', id);
  if (span) registerDocumentSpan(id, span);

  // If we are creating a new markdown document "from scratch" then we can let
  // them instantly start editing
  const createMdParams =
    blockName === 'md' || blockName === 'snippet'
      ? { optimisticSnapshot: await getMarkdownGoldenBytes() }
      : undefined;

  if (split) {
    split.replace({
      next: {
        type: blockName,
        id,
        params: createMdParams,
      },
      mergeHistory: true,
      referredFrom: 'launcher',
    });
  } else {
    openWithSplit(
      {
        type: blockName,
        id,
        ...(createMdParams ? { params: createMdParams } : {}),
      },
      {
        referredFrom: 'launcher',
        preferNewSplit: spec.shouldInsert,
      }
    );
  }

  span?.event('doc.navigated');
};

const createComponent = async (spec: {
  componentId: string;
  shouldInsert?: boolean;
  asPopover?: boolean;
}) => {
  const { openWithSplit, popoverSplit } = useSplitLayout();

  // For popovers, create the popover BEFORE closing launcher
  // so the popover can acquire the focus lock while launcher still owns rootFocusElement
  if (spec.asPopover) {
    popoverSplit({ type: 'component', id: spec.componentId });
    setCreateMenuOpen(false, false);
    return;
  }

  setCreateMenuOpen(false, false);

  openWithSplit(
    { type: 'component', id: spec.componentId },
    {
      referredFrom: 'launcher',
      preferNewSplit: spec.shouldInsert,
    }
  );
};

export function runCreateAction(
  blockName: CreatableName,
  options: { shouldInsert?: boolean; source?: string } = {}
) {
  const shouldInsert = options.shouldInsert ?? false;
  // Creation analytics fire at the data-layer chokepoints (create.ts /
  // projects.ts); `source` just attributes which surface initiated it.
  const source = options.source ?? 'create_menu';

  switch (blockName) {
    case 'md': {
      const span = startDocumentSpan('doc.create');
      span.setAttr('doc.type', 'md');
      span.setAttr('doc.source', source);
      void span
        .run(() =>
          createBlock({
            blockName: 'md',
            loading: true,
            span,
            createFn: () =>
              createMarkdownFile({
                title: '',
                content: '',
                projectId: undefined,
                source,
              }),
            shouldInsert,
          })
        )
        .catch((error) => {
          span.error(error);
          endTrackedDocumentSpan(span);
          throw error;
        });
      return;
    }
    case 'canvas':
      createBlock({
        blockName: 'canvas',
        loading: true,
        createFn: async () => {
          const result = await createCanvasFileFromJsonString({
            json: JSON.stringify({ nodes: [], edges: [] }),
            title: 'New Canvas',
            source,
          });
          if ('error' in result) return;
          return result.documentId ?? undefined;
        },
        shouldInsert,
      });
      return;
    case 'task':
      createComponent({
        componentId: 'task-compose',
        asPopover: true,
      });
      return;
    case 'snippet':
      createBlock({
        blockName: 'snippet',
        loading: true,
        createFn: () =>
          createSnippet({
            title: '',
            content: '',
            source,
          }),
        shouldInsert,
      });
      return;
    case 'email':
      // Focus the "To" field within this gesture so the iOS keyboard opens;
      // the compose mounts asynchronously, so this waits for the input.
      triggerFocusInput(() =>
        document.getElementById(EMAIL_COMPOSE_TO_INPUT_ID)
      );
      createComponent({
        componentId: 'email-compose',
        shouldInsert,
      });
      return;
    case 'channel':
      createComponent({
        componentId: 'channel-compose',
        shouldInsert,
      });
      return;
    case 'chat':
      // On mobile the chat input doesn't autofocus on mount, so arm focus
      // within this gesture (iOS only raises the keyboard for a synchronous
      // focus). The chat mounts asynchronously, so this waits for the input.
      if (isMobile()) {
        triggerFocusInput(() =>
          document
            .getElementById(CHAT_INPUT_TEXT_AREA_ID)
            ?.querySelector<HTMLElement>('[contenteditable="true"]')
        );
      }
      createBlock({
        blockName: 'chat',
        createFn: async () => {
          const result = await createChat(undefined, { source });
          if ('error' in result) {
            return;
          }
          return result.chatId;
        },
        shouldInsert,
      });
      return;
    case 'project':
      createBlock({
        blockName: 'project',
        createFn: () => createProject({ name: 'New Folder', source }),
        shouldInsert,
      });
      return;
    case 'code':
      createBlock({
        blockName: 'code',
        loading: true,
        createFn: async () => {
          const result = await createCodeFileFromText({
            code: 'print("Hello, World!")',
            extension: 'py',
            title: 'New Code File',
            source,
          });
          if (result.isErr()) return;
          return result.value.documentId ?? undefined;
        },
        shouldInsert,
      });
      return;
    case 'automation':
      setCreateMenuOpen(false, false);
      setAutomationComposerOpen(true, false);
      return;
    case 'skill':
      createComponent({
        componentId: 'skill-compose',
        asPopover: true,
      });
      return;
    // A reminder has no block to open: the composer asks what and when, and the
    // reminder lives in the Reminders lists from there.
    case 'reminder':
      if (!isFeatureEnabled(enableReminders)) return;
      setCreateMenuOpen(false, false);
      openStandaloneReminderComposer();
      return;
    // Nothing to ask for: a managed session's bot, repository and workspace
    // are all deployment configuration, so this opens one straight away.
    //
    // Opened against a placeholder rather than awaited: the create does not
    // answer until its sandbox has booted and cloned the repo, and no one
    // should watch a spinner for that. The block mounts now — composer live,
    // prompts queueing — and adopts the real id when it lands
    // (`block-agent/context/pending-session.ts`).
    case 'agent': {
      const { openWithSplit } = useSplitLayout();
      setCreateMenuOpen(false, false);
      openWithSplit(
        { type: 'agent', id: startPendingSession() },
        { referredFrom: 'launcher', preferNewSplit: shouldInsert }
      );
      return;
    }
  }
}

export type { CreatableBlock, CreatableName } from './types';

export const CREATABLE_BLOCKS: CreatableBlock[] = [
  {
    label: 'Email',
    icon: WideEmail,
    animatedIcon: AnimatedEmailIcon,
    description: 'Create email',
    keywords: ['new', 'make', 'add', 'compose'],
    blockName: 'email',
    hotkeyToken: TOKENS.create.email,
    altHotkeyToken: TOKENS.create.emailNewSplit,
    hotkey: 'e',
    keyDownHandler: () => {
      runCreateAction('email', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    // The pre-agent-session chat, kept on `a` for anyone the new agent flag
    // has not reached. Mutually exclusive with the Coding Agent entry below:
    // both bind `a`, and exactly one is ever enabled.
    label: 'Agent',
    icon: WideStar,
    animatedIcon: AnimatedStarIcon,
    description: 'Create agent chat',
    launcherHint: 'New agent session',
    keywords: ['new', 'make', 'add', 'agent'],
    blockName: 'chat',
    hotkeyToken: TOKENS.create.chat,
    altHotkeyToken: TOKENS.create.chatNewSplit,
    hotkey: 'a',
    // Both `a` entries have to survive registration for the dispatcher to
    // pick between them by condition; the default 'override' would let the
    // later one silently replace the earlier.
    registrationType: 'add',
    enabled: () => !isFeatureEnabled(enableChatV3Agents),
    keyDownHandler: () => {
      runCreateAction('chat', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Automation',
    icon: WideAutomation,
    description: 'Create automation',
    launcherHint: 'Scheduled agent runs',
    keywords: ['new', 'make', 'add', 'schedule', 'agent'],
    blockName: 'automation',
    hotkeyToken: TOKENS.create.automation,
    hotkey: 'u',
    keyDownHandler: () => {
      runCreateAction('automation');
      return true;
    },
  },
  {
    label: 'Coding Agent',
    icon: Robot,
    description: 'Create agent session',
    launcherHint: 'Sandboxed coding session',
    keywords: ['new', 'make', 'add', 'agent', 'code', 'coder', 'session'],
    blockName: 'agent',
    hotkeyToken: TOKENS.create.agent,
    altHotkeyToken: TOKENS.create.agentNewSplit,
    hotkey: 'a',
    registrationType: 'add',
    enabled: () => isFeatureEnabled(enableChatV3Agents),
    keyDownHandler: () => {
      runCreateAction('agent', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Skill',
    icon: SkillIcon,
    description: 'Create skill',
    launcherHint: 'Custom agent skill',
    keywords: ['new', 'make', 'add', 'instruction', 'prompt'],
    blockName: 'skill',
    hotkeyToken: TOKENS.create.skill,
    hotkey: 'k',
    keyDownHandler: () => {
      runCreateAction('skill');
      return true;
    },
  },
  {
    label: 'Document',
    icon: WideFileMd,
    animatedIcon: AnimatedFileMdIcon,
    description: 'Create doc',
    keywords: ['new', 'make', 'add', 'document', 'note'],
    blockName: 'md',
    hotkeyToken: TOKENS.create.note,
    altHotkeyToken: TOKENS.create.noteNewSplit,
    hotkey: 'd',
    keyDownHandler: () => {
      runCreateAction('md', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Task',
    icon: WideTask,
    animatedIcon: AnimatedTaskIcon,
    description: 'Create task',
    keywords: ['new', 'make', 'add', 'todo'],
    blockName: 'task',
    hotkeyToken: TOKENS.create.task,
    altHotkeyToken: TOKENS.create.taskNewSplit,
    hotkey: 't' as const,
    keyDownHandler: () => {
      runCreateAction('task');
      return true;
    },
  },
  {
    label: 'Reminder',
    icon: BellSimpleIcon,
    description: 'Create reminder',
    launcherHint: 'Nudge yourself later',
    keywords: ['new', 'make', 'add', 'remind', 'later', 'todo'],
    blockName: 'reminder',
    hotkeyToken: TOKENS.create.reminder,
    // No `altHotkeyToken`: a reminder opens no split, so there is no
    // shift-variant to bind.
    hotkey: 'r',
    enabled: () => isFeatureEnabled(enableReminders),
    keyDownHandler: () => {
      runCreateAction('reminder');
      return true;
    },
  },
  {
    label: 'Snippet',
    icon: WideSnippet,
    animatedIcon: AnimatedSnippetIcon,
    description: 'Create snippet',
    launcherHint: 'Reusable document template',
    keywords: ['new', 'make', 'add'],
    blockName: 'snippet',
    hotkeyToken: TOKENS.create.snippet,
    altHotkeyToken: TOKENS.create.snippetNewSplit,
    hotkey: 's' as const,
    keyDownHandler: () => {
      runCreateAction('snippet', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Message',
    icon: WideChat,
    animatedIcon: AnimatedChatIcon,
    description: 'Create message',
    launcherHint: 'Quick send message',
    keywords: ['new', 'make', 'add', 'channel'],
    blockName: 'channel',
    hotkeyToken: TOKENS.create.message,
    altHotkeyToken: TOKENS.create.messageNewSplit,
    hotkey: 'm',
    keyDownHandler: () => {
      runCreateAction('channel', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Channel',
    icon: WideChannel,
    animatedIcon: AnimatedChannelIcon,
    description: 'Create channel',
    launcherHint: 'Team-wide or group chat',
    keywords: ['new', 'make', 'add', 'channel', 'group', 'conversation'],
    blockName: 'channel',
    hotkeyToken: TOKENS.create.channel,
    hotkey: 'g',
    keyDownHandler: () => {
      openNewChannelModal();
      setCreateMenuOpen(false, false);
      return true;
    },
  },
  {
    label: 'Canvas',
    icon: WideDiagram,
    animatedIcon: AnimatedDiagramIcon,
    description: 'Create canvas',
    keywords: ['new', 'make', 'add', 'diagram'],
    blockName: 'canvas',
    hotkeyToken: TOKENS.create.canvas,
    altHotkeyToken: TOKENS.create.canvasNewSplit,
    hotkey: 'n',
    keyDownHandler: () => {
      runCreateAction('canvas', {
        shouldInsert: pressedKeys().has('shift'),
      });
      return true;
    },
  },
  {
    label: 'Folder',
    icon: WideFolder,
    animatedIcon: AnimatedFolderIcon,
    description: 'Create folder',
    keywords: ['new', 'make', 'add', 'project'],
    blockName: 'project',
    hotkeyToken: TOKENS.create.project,
    altHotkeyToken: TOKENS.create.projectNewSplit,
    hotkey: 'f',
    keyDownHandler: () => {
      runCreateAction('project', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Code',
    icon: WideFileCode,
    animatedIcon: AnimatedFileCodeIcon,
    description: 'Create code file',
    keywords: ['new', 'make', 'add'],
    blockName: 'code',
    hotkeyToken: TOKENS.create.code,
    altHotkeyToken: TOKENS.create.codeNewSplit,
    hotkey: 'o',
    keyDownHandler: () => {
      runCreateAction('code', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
];

/**
 * The creatable-block entries a create menu renders, with feature gating
 * applied — the single source of truth shared by the desktop menus and the
 * mobile dock's Create menu, so they cannot drift. Callers with a custom
 * block list (e.g. the onboarding sandbox launcher) pass it as `source` to
 * run it through the same gating.
 */
export function useCreateMenuBlocks(
  source: () => CreatableBlock[] = () => CREATABLE_BLOCKS
): Accessor<CreatableBlock[]> {
  const snippetsFlag = useFeatureFlag(enableSnippets);
  // Subscribed to rather than left to the block's own `enabled`, which reads
  // PostHog without tracking it: this memo has no other reason to re-run, so a
  // flag that resolves after mount would leave the menu as it was until reload.
  const remindersFlag = useFeatureFlag(enableReminders);
  const agentsFlag = useFeatureFlag(enableChatV3Agents);
  return createMemo(() => {
    remindersFlag();
    agentsFlag();
    return source().filter((block) => {
      if (block.blockName === 'snippet') return snippetsFlag().enabled;
      return block.enabled?.() ?? true;
    });
  });
}

/**
 * Whether one creatable is on offer right now, tracked reactively.
 *
 * For the surfaces that offer a single creatable by name rather than rendering
 * the whole list — an empty state's button, a list view's `+`. Answered from
 * {@link useCreateMenuBlocks} so there is one gate rather than a copy of it per
 * surface, and so a flag that resolves after mount reaches these too: a gated
 * entry left to its own `enabled` reads PostHog without tracking it, which
 * strands the answer the surface first happened to get.
 *
 * A name that is not a creatable-block entry at all is not "disabled" — it is
 * not this gate's business, and callers reaching for a view-only label handle
 * it themselves.
 */
export function useCreatableEnabled(): (name: CreatableName) => boolean {
  const blocks = useCreateMenuBlocks();
  return (name) => blocks().some((block) => block.blockName === name);
}

export const [createMenuOpen, setCreateMenuOpen] = createControlledOpenSignal(
  false,
  { id: 'launcher' }
);

type LauncherMenuItemProps = {
  creatableBlock: CreatableBlock;
  selected?: boolean;
  showHotkey?: boolean;
};

const LauncherMenuItem = (props: LauncherMenuItemProps) => {
  const StaticIcon = props.creatableBlock.icon;
  const AnimatedIcon = props.creatableBlock.animatedIcon;
  const selectedIconColor = () =>
    getIconConfig(props.creatableBlock.blockName).foreground;
  const launcherHint = () => props.creatableBlock.launcherHint;

  return (
    <>
      <div
        class={cn(
          'size-4 shrink-0 text-ink-extra-muted transition-colors',
          props.selected && selectedIconColor()
        )}
      >
        <Show
          when={ENABLE_ANIMATED_ICONS && AnimatedIcon}
          fallback={<Dynamic component={StaticIcon} />}
        >
          {(icon) => (
            <Dynamic component={icon()} triggerAnimation={props.selected} />
          )}
        </Show>
      </div>

      <div class="min-w-0 flex-1 flex items-baseline gap-2">
        <span class="truncate text-sm font-medium text-ink">
          {props.creatableBlock.label}
        </span>
        <Show when={launcherHint()}>
          {(hint) => (
            <span class="min-w-0 truncate font-medium text-ink-extra-muted/70">
              {hint()}
            </span>
          )}
        </Show>
      </div>

      <Show when={props.showHotkey}>
        <div class="flex border border-edge-muted text-xxs rounded-md items-center px-1.5 py-px font-normal text-ink-muted">
          <Hotkey token={props.creatableBlock.hotkeyToken} />
        </div>
      </Show>
    </>
  );
};

type LauncherInnerProps = {
  onClose: (shouldReturnFocus?: boolean) => void;
  blocks?: CreatableBlock[];
};

export const LauncherInner = (props: LauncherInnerProps) => {
  const hkGroup = createHotkeyGroup();
  const availableBlocks = useCreateMenuBlocks(
    () => props.blocks ?? CREATABLE_BLOCKS
  );
  const sortedBlocks = createMemo(() => {
    const now = Date.now();

    return availableBlocks()
      .map((item, index) => ({
        item,
        index,
        score: launcherFrecencyScore(item, now),
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ item }) => item);
  });
  const [searchQuery, setSearchQuery] = createSignal('');
  const searchMode = launcherSearchMode;
  const blocks = createMemo(() => {
    if (!searchMode()) return sortedBlocks();

    return sortedBlocks().filter((item) =>
      matchesLauncherSearch(item, searchQuery())
    );
  });
  const [attachHotkeys, launcherScope] = useHotkeyDOMScope('create-menu', true);

  let ref!: HTMLDivElement;
  let searchInputRef: HTMLInputElement | undefined;
  let shiftRippleRef: HTMLSpanElement | undefined;

  const shiftHeld = () => pressedKeys().has('shift');

  const [focusedIndex, setFocusedIndex] = createSignal(0);
  const listController = createCommandListController({
    items: blocks,
    selectedIndex: focusedIndex,
    setSelectedIndex: setFocusedIndex,
  });

  const runLauncherItem = (
    item: CreatableBlock | undefined,
    shouldReturnFocus?: boolean
  ) => {
    if (!item) return false;

    trackLauncherItemUsage(item);
    item.keyDownHandler();
    props.onClose(shouldReturnFocus);

    return true;
  };

  const setLauncherSearchMode = (next: boolean) => {
    setLauncherSearchModePreference(next);

    if (!next) {
      setSearchQuery('');
    }

    queueMicrotask(() => {
      if (next) {
        searchInputRef?.focus({ preventScroll: true });
      } else {
        ref?.focus({ preventScroll: true });
      }
    });
  };

  createEffect(() => {
    searchMode();
    searchQuery();
    blocks().length;
    setFocusedIndex(0);
  });

  availableBlocks().forEach((item) => {
    registerHotkey({
      hotkeyToken: item.hotkeyToken,
      hotkey: item.hotkey,
      scopeId: launcherScope,
      description: item.description,
      keyDownHandler: () => {
        return runLauncherItem(item, false);
      },
    }).withGroup(hkGroup);

    if (item.altHotkeyToken) {
      registerHotkey({
        hotkeyToken: item.altHotkeyToken,
        hotkey: `shift+${item.hotkey}` as ValidHotkey,
        scopeId: launcherScope,
        description: `${item.description} in new split`,
        keyDownHandler: () => {
          return runLauncherItem(item);
        },
      }).withGroup(hkGroup);
    }
  });

  registerHotkey({
    hotkey: 'c',
    scopeId: launcherScope,
    description: 'Close Launcher',
    condition: createMenuOpen,
    keyDownHandler: () => {
      setCreateMenuOpen(false);
      return true;
    },
  }).withGroup(hkGroup);

  const navUpHotkey = registerHotkey({
    hotkey: ['arrowup', 'ctrl+k', 'shift+tab'],
    scopeId: launcherScope,
    description: 'Navigate up',
    keyDownHandler: (event) => {
      event?.preventDefault();
      return listController.selectPrevious();
    },
    runWithInputFocused: true,
  }).withGroup(hkGroup);

  const navDownHotkey = registerHotkey({
    hotkey: ['arrowdown', 'ctrl+j', 'tab'],
    scopeId: launcherScope,
    description: 'Navigate down',
    keyDownHandler: (event) => {
      event?.preventDefault();
      return listController.selectNext();
    },
    runWithInputFocused: true,
  }).withGroup(hkGroup);

  const searchModeHotkey = registerHotkey({
    hotkey: '/',
    scopeId: launcherScope,
    description: 'Toggle search mode',
    keyDownHandler: () => {
      setLauncherSearchMode(!searchMode());
      return true;
    },
    runWithInputFocused: true,
    displayPriority: 6,
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: 'escape',
    scopeId: launcherScope,
    description: 'Exit',
    keyDownHandler: () => {
      props.onClose();
      return true;
    },
  }).withGroup(hkGroup);

  registerHotkey({
    hotkey: 'shift+enter',
    scopeId: launcherScope,
    description: 'Open in new split',
    keyDownHandler: () => {
      return runLauncherItem(blocks()[focusedIndex()]);
    },
    runWithInputFocused: true,
    displayPriority: 7,
  }).withGroup(hkGroup);

  const confirmHotkey = registerHotkey({
    hotkey: 'enter' as ValidHotkey,
    scopeId: launcherScope,
    description: 'Open in current split',
    keyDownHandler: () => {
      return runLauncherItem(blocks()[focusedIndex()]);
    },
    runWithInputFocused: true,
    displayPriority: 8,
  }).withGroup(hkGroup);

  onMount(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !e.repeat && shiftRippleRef) {
        shiftRippleRef.classList.remove('rippling');
        void shiftRippleRef.offsetWidth; // reflow to restart animation
        shiftRippleRef.classList.add('rippling');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    onCleanup(() => window.removeEventListener('keydown', onKeyDown));
  });

  onMount(() => {
    if (!ref) return;
    attachHotkeys(ref);
    queueMicrotask(() => {
      if (searchMode()) {
        searchInputRef?.focus({ preventScroll: true });
      } else {
        ref.focus({ preventScroll: true });
      }
    });
  });

  onCleanup(hkGroup.dispose);

  return (
    <div
      class="w-200 max-w-[calc(100vw-16px)] rounded-xl"
      style={{
        'box-shadow':
          '0 5px 40px rgba(0, 0, 0, 0.1), 0 5px 50px rgba(0,0,0,0.03)',
      }}
    >
      <CommandMenuShell
        depth={2}
        class="h-auto w-full outline-none"
        ref={ref}
        tabindex={-1}
      >
        <CommandMenuShell.Header class="gap-2 px-4 my-1 border-b-0">
          <Show
            when={searchMode()}
            fallback={
              <div class="min-w-0 flex flex-1 items-center gap-2 text-ink-muted">
                <PlusIcon class="size-4 shrink-0 text-ink-extra-muted" />
                <h1 class="truncate text-base font-normal">Create New</h1>
              </div>
            }
          >
            <div class="min-w-0 flex flex-1 items-center gap-2">
              <MagnifyingGlassIcon class="size-4 shrink-0 text-ink-extra-muted" />
              <CommandMenuSearchInput
                ref={searchInputRef}
                type="text"
                placeholder="Search create options"
                value={searchQuery()}
                onInput={(event) => setSearchQuery(event.currentTarget.value)}
              />
            </div>
          </Show>
          <ToggleSwitch
            checked={searchMode()}
            onChange={setLauncherSearchMode}
            size="xs"
            label={
              <span class="flex items-center gap-1 text-[11px] font-medium leading-none text-ink-extra-muted/70">
                Search mode{' '}
                <Hotkey
                  shortcut={searchModeHotkey.hotkey()}
                  theme="subtle"
                  class="px-2 py-0.5"
                />
              </span>
            }
            labelClass="flex items-center"
            controlClass="bg-ink-extra-muted/25 data-checked:bg-accent"
            class="ml-auto flex-row-reverse gap-1.5 px-2 py-1"
          />
        </CommandMenuShell.Header>
        <CommandMenuShell.Body>
          <CommandMenuList
            items={blocks()}
            selectedIndex={focusedIndex()}
            scrollSelectedIntoView={listController.shouldScrollSelectedIntoView()}
            class="max-h-[min(60vh,26rem)]"
            itemId={(item) => `create-menu-${launcherItemKey(item)}`}
            onSelect={(item) => runLauncherItem(item)}
            onItemMouseMove={(index) =>
              listController.setSelectedIndexFromPointer(index)
            }
          >
            {(item, index) => (
              <LauncherMenuItem
                creatableBlock={item}
                selected={focusedIndex() === index()}
                showHotkey={!searchMode()}
              />
            )}
          </CommandMenuList>
        </CommandMenuShell.Body>
        <CommandMenuShell.Footer>
          <style>{`
              @keyframes shift-ripple {
                0%   { transform: scale(1); opacity: 0.6; }
                100% { transform: scale(2.2); opacity: 0; }
              }
              .shift-ripple.rippling {
                animation: shift-ripple 0.35s cubic-bezier(0.2, 0.8, 0.4, 1) forwards;
              }
            `}</style>
          <span class="flex items-center gap-1">
            <div class="flex gap-1">
              <div class="flex border border-edge-muted text-xxs rounded-md items-center px-1.5 py-px font-normal">
                <Hotkey shortcut={navUpHotkey.hotkey()} class="space-x-1" />
              </div>
              <div class="flex border border-edge-muted text-xxs rounded-md items-center px-1.5 py-px font-normal">
                <Hotkey shortcut={navDownHotkey.hotkey()} class="space-x-1" />
              </div>
            </div>
            Navigate
          </span>
          <CommandMenuHotkeyHint
            hotkey={<Hotkey shortcut={confirmHotkey.hotkey()} />}
            label="Create"
          />
          <span class="hidden touch:hidden md:flex items-center gap-1">
            Hold
            <span class="relative inline-flex place-items-center">
              <span
                ref={shiftRippleRef}
                class="shift-ripple absolute inset-0 rounded-sm border border-accent pointer-events-none opacity-0"
              />
              <span
                class={cn(
                  'border text-xxs px-1.5 py-px rounded-md transition-colors duration-150',
                  shiftHeld()
                    ? 'border-accent text-accent bg-accent/10'
                    : 'border-edge-muted'
                )}
              >
                {getNormalizedKeyString({ shortcut: 'shift' })}
              </span>
            </span>
            New split
          </span>
        </CommandMenuShell.Footer>
      </CommandMenuShell>
    </div>
  );
};

type LauncherProps = {
  open: boolean;
  onOpenChange: (open: boolean, shouldReturnFocus?: boolean) => void;
};

export const Launcher = (props: LauncherProps) => {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal={true}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal"></Dialog.Overlay>
        <Dialog.Content class="[--color-surface:var(--color-dialog)]">
          <div
            class={cn(
              'fixed top-0 bottom-(--virtual-keyboard-height,0) inset-x-0 z-modal w-screen flex justify-center px-2',
              isMobile() ? 'items-center' : 'items-start pt-[10vh]'
            )}
            onClick={(e) => {
              if (e.target === e.currentTarget) {
                props.onOpenChange(false);
              }
            }}
          >
            <LauncherInner
              onClose={(shouldReturnFocus) =>
                props.onOpenChange(false, shouldReturnFocus)
              }
            />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
};
