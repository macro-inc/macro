import { openAgentComposer } from '@app/features/agents-view/primitives/open-composer';
import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { AGENT_INPUT_TEXT_AREA_ID } from '@app/features/block-agent/ui/AgentInput';
import { createAiDocument } from '@app/features/block-ai/queries/create-ai';
import { createFigDocument } from '@app/features/block-fig/queries/create-fig';
import { createPsdDocument } from '@app/features/block-psd/queries/create-psd';
import { useSpreadsheetAccess } from '@app/features/block-spreadsheet/primitives/use-spreadsheet-access';
import { createSpreadsheetDocument } from '@app/features/block-spreadsheet/queries/create-spreadsheet';
import { isSpreadsheetEnabledForCurrentUser } from '@app/features/block-spreadsheet/queries/spreadsheet-access';
import { EMAIL_COMPOSE_TO_INPUT_ID } from '@app/features/email-compose/core/constants';
import { useQuickCallsFlag } from '@app/features/meetings/use-quick-calls-flag';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
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
import { toast } from '@core/component/Toast/Toast';
import {
  enableAiEditor,
  enableCarouselCreateMenu,
  enableChatV3Agents,
  enableDatabases,
  enableFigViewer,
  enableForms,
  enableProjects,
  enablePsdEditor,
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
import { Dialog } from '@kobalte/core/dialog';
import { getMarkdownGoldenBytes } from '@macro-inc/lexical-core/markdown-golden';
import type { Span } from '@macro-inc/observability';
import ChatIcon from '@phosphor/chat.svg';
import MagnifyingGlassIcon from '@phosphor/magnifying-glass.svg';
import PlusIcon from '@phosphor/plus.svg';
import { createDatabase } from '@queries/storage/databases';
import { createForm } from '@queries/storage/forms';
import { createProject } from '@queries/storage/projects';
import { makePersisted } from '@solid-primitives/storage';
import { useNavigate } from '@solidjs/router';
import {
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
  createMemo,
  createSignal,
  type JSX,
  lazy,
  onCleanup,
  onMount,
  Show,
  Suspense,
} from 'solid-js';
import { createStore } from 'solid-js/store';
import { Dynamic } from 'solid-js/web';
import type { CreateMenuSection } from './core/create-menu-details';
import {
  launcherItemKey,
  recentLauncherBlocks,
  sortLauncherBlocks,
} from './core/launcher-history';
import { createCallCommand } from './create-call-command';
import { MobileCreateSheet } from './mobile/MobileCreateSheet';
import type { CreatableBlock, CreatableName } from './types';

const LAUNCHER_FRECENCY_STORE = 'launcher-frecency-v1';
const LAUNCHER_SEARCH_MODE_STORE = 'launcher-search-mode-v1';

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

export function useRecentCreateMenuBlocks(items: Accessor<CreatableBlock[]>) {
  return createMemo(() => recentLauncherBlocks(items(), launcherFrecencyStore));
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

  // On mobile, navigate directly after creation instead of showing an
  // intermediate loading pane during the swipe transition.
  const showLoadingFirst = loading && !isMobile();

  const split = showLoadingFirst
    ? openWithSplit(
        { type: 'component', id: 'loading' },
        { referredFrom: 'launcher', preferNewSplit: spec.shouldInsert }
      ).split
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
  params?: Record<string, unknown>;
}) => {
  const { openWithSplit, popoverSplit } = useSplitLayout();

  // For popovers, create the popover BEFORE closing launcher
  // so the popover can acquire the focus lock while launcher still owns rootFocusElement
  if (spec.asPopover) {
    popoverSplit({
      type: 'component',
      id: spec.componentId,
      params: spec.params,
    });
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
  options: { shouldInsert?: boolean; source?: string; projectId?: string } = {}
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
                projectId: options.projectId,
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
    case 'spreadsheet':
      if (!isSpreadsheetEnabledForCurrentUser()) return;
      void createBlock({
        blockName: 'spreadsheet',
        loading: true,
        createFn: () =>
          createSpreadsheetDocument({
            projectId: options.projectId,
            source,
          }),
        shouldInsert,
      });
      return;
    case 'psd':
      if (!isFeatureEnabled(enablePsdEditor)) return;
      createBlock({
        blockName: 'psd',
        loading: true,
        createFn: () =>
          createPsdDocument({ projectId: options.projectId, source }),
        shouldInsert,
      });
      return;
    case 'fig':
      if (!isFeatureEnabled(enableFigViewer)) return;
      createBlock({
        blockName: 'fig',
        loading: true,
        createFn: () =>
          createFigDocument({ projectId: options.projectId, source }),
        shouldInsert,
      });
      return;
    case 'ai':
      if (!isFeatureEnabled(enableAiEditor)) return;
      createBlock({
        blockName: 'ai',
        loading: true,
        createFn: () =>
          createAiDocument({ projectId: options.projectId, source }),
        shouldInsert,
      });
      return;
    case 'canvas':
      createBlock({
        blockName: 'canvas',
        loading: true,
        createFn: async () => {
          const result = await createCanvasFileFromJsonString({
            json: JSON.stringify({ nodes: [], edges: [] }),
            title: 'New Canvas',
            projectId: options.projectId,
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
    case 'initiative':
      if (!isFeatureEnabled(enableProjects)) return;
      createComponent({
        componentId: 'project-compose',
        asPopover: true,
      });
      return;
    case 'snippet':
      createBlock({
        blockName: 'snippet',
        loading: true,
        createFn: () =>
          createSnippet({
            projectId: options.projectId,
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
      if (isFeatureEnabled(enableChatV3Agents)) {
        setCreateMenuOpen(false, false);
        openAgentComposer(useSplitLayout(), shouldInsert);
        return;
      }
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
        createFn: () =>
          createProject({
            name: 'New Folder',
            source,
            parentId: options.projectId,
          }),
        shouldInsert,
      });
      return;
    case 'database':
      if (!isFeatureEnabled(enableDatabases)) return;
      createBlock({
        blockName: 'database',
        loading: true,
        createFn: async () => {
          const created = await createDatabase({
            name: 'Untitled database',
            source,
          });
          if (created.isErr()) {
            toast.failure('Could not create the database');
            return;
          }
          return created.value;
        },
        shouldInsert,
      });
      return;
    case 'form':
      if (!isFeatureEnabled(enableForms)) return;
      createBlock({
        blockName: 'form',
        loading: true,
        createFn: async () => {
          const created = await createForm(
            { name: 'Untitled form', source: { kind: 'new' } },
            source
          );
          if (created.isErr()) {
            toast.failure('Could not create the form');
            return;
          }
          return created.value.form.id;
        },
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
            projectId: options.projectId,
            source,
          });
          if (result.isErr()) return;
          return result.value.documentId ?? undefined;
        },
        shouldInsert,
      });
      return;
    case 'routine':
      createComponent({ componentId: 'routine-compose', asPopover: true });
      return;
    case 'skill':
      createComponent({
        componentId: 'skill-compose',
        asPopover: true,
      });
      return;
    case 'agent': {
      if (isFeatureEnabled(enableChatV3Agents)) {
        setCreateMenuOpen(false, false);
        openAgentComposer(useSplitLayout(), shouldInsert);
        return;
      }
      // Without the composer there is nothing to ask for: a managed session's
      // bot, repository and workspace are all deployment configuration, so
      // this opens one straight away.
      //
      // Opened against a placeholder rather than awaited: the create does not
      // answer until its sandbox has booted and cloned the repo, and no one
      // should watch a spinner for that. The block mounts now — composer live,
      // prompts queueing — and adopts the real id when it lands
      // (`block-agent/context/pending-session.ts`).
      const { openWithSplit } = useSplitLayout();
      setCreateMenuOpen(false, false);
      // On mobile the agent input doesn't autofocus on mount, so arm focus
      // within this gesture (iOS only raises the keyboard for a synchronous
      // focus). The block mounts asynchronously, so this waits for the input.
      if (isMobile()) {
        triggerFocusInput(() =>
          document
            .getElementById(AGENT_INPUT_TEXT_AREA_ID)
            ?.querySelector<HTMLElement>('[contenteditable="true"]')
        );
      }
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
    icon: getIconConfig('email').icon,
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
    // has not reached. Mutually exclusive with the Agent entry below:
    // both bind `a`, and exactly one is ever enabled.
    label: 'Agent',
    icon: getIconConfig('chat').icon,
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
    label: 'Routine',
    icon: getIconConfig('routine').icon,
    description: 'Run a model or agent on a schedule or Macro activity',
    launcherHint: 'Schedules and activity triggers',
    keywords: ['new', 'make', 'add', 'schedule', 'agent', 'event', 'trigger'],
    blockName: 'routine',
    hotkeyToken: TOKENS.create.routine,
    hotkey: 'u',
    keyDownHandler: () => {
      runCreateAction('routine');
      return true;
    },
  },
  {
    label: 'Agent',
    icon: getIconConfig('agent').icon,
    description: 'Create agent session',
    launcherHint: 'Dedicated Agent Session',
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
    label: 'Database',
    icon: getIconConfig('database').icon,
    description: 'Create database',
    launcherHint: 'Tables and boards',
    keywords: ['new', 'make', 'add', 'database', 'table', 'db'],
    blockName: 'database',
    enabled: () => isFeatureEnabled(enableDatabases),
    hotkeyToken: TOKENS.create.database,
    altHotkeyToken: TOKENS.create.databaseNewSplit,
    hotkey: 'l',
    keyDownHandler: () => {
      runCreateAction('database', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Form',
    icon: getIconConfig('form').icon,
    description: 'Create form',
    launcherHint: 'Questions answered into a database',
    keywords: ['new', 'make', 'add', 'form', 'survey', 'questionnaire', 'poll'],
    blockName: 'form',
    enabled: () => isFeatureEnabled(enableForms),
    hotkeyToken: TOKENS.create.form,
    altHotkeyToken: TOKENS.create.formNewSplit,
    hotkey: 'q',
    keyDownHandler: () => {
      runCreateAction('form', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Skill',
    icon: getIconConfig('skill').icon,
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
    icon: getIconConfig('md').icon,
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
    icon: getIconConfig('task').icon,
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
    label: 'Project',
    icon: getIconConfig('initiative').icon,
    description: 'Create project',
    keywords: ['new', 'make', 'add', 'project'],
    blockName: 'initiative',
    enabled: () => isFeatureEnabled(enableProjects),
    hotkeyToken: TOKENS.create.initiative,
    hotkey: 'p',
    keyDownHandler: () => {
      runCreateAction('initiative');
      return true;
    },
  },
  {
    label: 'Snippet',
    icon: getIconConfig('snippet').icon,
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
    icon: ChatIcon,
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
    icon: getIconConfig('channel').icon,
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
    icon: getIconConfig('canvas').icon,
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
    label: 'Photoshop file',
    enabled: () => isFeatureEnabled(enablePsdEditor),
    icon: getIconConfig('psd').icon,
    description: 'New Photoshop file',
    launcherHint: 'Layered image editing, saved as .psd',
    keywords: ['new', 'make', 'add', 'photoshop', 'psd', 'image', 'photo'],
    blockName: 'psd',
    hotkeyToken: TOKENS.create.photoshop,
    altHotkeyToken: TOKENS.create.photoshopNewSplit,
    hotkey: 'h',
    keyDownHandler: () => {
      runCreateAction('psd', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Design',
    enabled: () => isFeatureEnabled(enableFigViewer),
    icon: getIconConfig('fig').icon,
    description: 'Create design',
    launcherHint: 'Figma-compatible canvas for UI and graphics',
    keywords: ['new', 'make', 'add', 'design', 'figma', 'mockup', 'ui'],
    blockName: 'fig',
    hotkeyToken: TOKENS.create.design,
    altHotkeyToken: TOKENS.create.designNewSplit,
    hotkey: 'i',
    keyDownHandler: () => {
      runCreateAction('fig', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Illustrator file',
    enabled: () => isFeatureEnabled(enableAiEditor),
    icon: getIconConfig('ai').icon,
    description: 'Create Illustrator file',
    launcherHint: 'Vector artwork on artboards, saved as .ai',
    keywords: [
      'new',
      'make',
      'add',
      'illustrator',
      'illustration',
      'vector',
      'artboard',
    ],
    blockName: 'ai',
    hotkeyToken: TOKENS.create.illustration,
    altHotkeyToken: TOKENS.create.illustrationNewSplit,
    hotkey: 'v',
    keyDownHandler: () => {
      runCreateAction('ai', { shouldInsert: pressedKeys().has('shift') });
      return true;
    },
  },
  {
    label: 'Spreadsheet',
    enabled: isSpreadsheetEnabledForCurrentUser,
    icon: getIconConfig('spreadsheet').icon,
    description: 'Create spreadsheet',
    launcherHint: 'Tables, formulas, and shared calculations',
    keywords: ['new', 'make', 'add', 'sheet', 'table', 'formula'],
    blockName: 'spreadsheet',
    hotkeyToken: TOKENS.create.spreadsheet,
    altHotkeyToken: TOKENS.create.spreadsheetNewSplit,
    hotkey: 'b',
    keyDownHandler: () => {
      runCreateAction('spreadsheet', {
        shouldInsert: pressedKeys().has('shift'),
      });
      return true;
    },
  },
  {
    label: 'Folder',
    icon: getIconConfig('project').icon,
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
    icon: getIconConfig('code').icon,
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

/** Router-backed commands are bound once in each host's component owner. */
export function useCreateCommands(): CreatableBlock[] {
  const navigate = useNavigate();
  const quickCalls = useQuickCallsFlag();
  return [
    ...CREATABLE_BLOCKS,
    createCallCommand({
      navigate,
      close: () => setCreateMenuOpen(false, false),
      enabled: () => quickCalls().enabled,
    }),
  ];
}

/**
 * The creatable-block entries a create menu renders, with feature gating
 * applied — the single source of truth shared by the desktop menus and the
 * mobile page create actions, so they cannot drift. Callers with a custom
 * block list (e.g. the onboarding sandbox launcher) pass it as `source` to
 * run it through the same gating.
 */
export function useCreateMenuBlocks(
  source: () => CreatableBlock[] | undefined = () => undefined
): Accessor<CreatableBlock[]> {
  const commands = useCreateCommands();
  const spreadsheets = useSpreadsheetAccess();
  const snippetsFlag = useFeatureFlag(enableSnippets);
  // Subscribed to rather than left to the block's own `enabled`, which reads
  // PostHog without tracking it: this memo has no other reason to re-run, so a
  // flag that resolves after mount would leave the menu as it was until reload.
  const agentsFlag = useFeatureFlag(enableChatV3Agents);
  const projectsFlag = useFeatureFlag(enableProjects);
  const databasesFlag = useFeatureFlag(enableDatabases);
  const psdFlag = useFeatureFlag(enablePsdEditor);
  const figFlag = useFeatureFlag(enableFigViewer);
  const aiFlag = useFeatureFlag(enableAiEditor);
  const formsFlag = useFeatureFlag(enableForms);
  return createMemo(() => {
    agentsFlag();
    databasesFlag();
    psdFlag();
    figFlag();
    aiFlag();
    formsFlag();
    return (source() ?? commands).filter((block) => {
      if (block.blockName === 'spreadsheet') return spreadsheets();
      if (block.blockName === 'snippet') return snippetsFlag().enabled;
      if (block.blockName === 'initiative') return projectsFlag().enabled;
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

export const LauncherMenuItem = (props: LauncherMenuItemProps) => {
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
        <Dynamic component={props.creatableBlock.icon} />
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
        <div class="flex border border-ink/12 text-xxs rounded-md items-center px-1.5 py-px font-normal text-ink-muted">
          <Hotkey token={props.creatableBlock.hotkeyToken} />
        </div>
      </Show>
    </>
  );
};

export type LauncherInnerProps = {
  onClose: (shouldReturnFocus?: boolean) => void;
  blocks?: CreatableBlock[];
};

type LauncherBodyState = {
  sections: Accessor<CreateMenuSection[]>;
  blocks: Accessor<CreatableBlock[]>;
  selectedIndex: Accessor<number>;
  searchMode: Accessor<boolean>;
  itemId: (item: CreatableBlock) => string;
  select: (index: number) => void;
  step: (direction: number) => void;
  choose: (item: CreatableBlock) => void;
  scrollSelectedIntoView: Accessor<boolean>;
};

/** Shared launcher behavior and chrome; each layout supplies its own body. */
export const LauncherShell = (
  props: LauncherInnerProps & {
    children: (state: LauncherBodyState) => JSX.Element;
    class?: string;
    horizontalNavigation?: boolean;
    groupItems?: (
      items: CreatableBlock[],
      recentItems: CreatableBlock[]
    ) => CreateMenuSection[];
  }
) => {
  const hkGroup = createHotkeyGroup();
  const commands = useCreateCommands();
  const candidates = () => props.blocks ?? commands;
  const availableBlocks = useCreateMenuBlocks(candidates);
  const sortedBlocks = createMemo(() =>
    sortLauncherBlocks(availableBlocks(), launcherFrecencyStore)
  );
  const [searchQuery, setSearchQuery] = createSignal('');
  const searchMode = launcherSearchMode;
  const recentBlocks = useRecentCreateMenuBlocks(availableBlocks);
  const filteredBlocks = createMemo(() => {
    if (!searchMode()) return sortedBlocks();

    return sortedBlocks().filter((item) =>
      matchesLauncherSearch(item, searchQuery())
    );
  });
  const sections = createMemo<CreateMenuSection[]>(
    () =>
      props.groupItems?.(filteredBlocks(), recentBlocks()) ?? [
        {
          group: { id: 'other', label: 'Results', tagline: '' },
          items: filteredBlocks(),
        },
      ]
  );
  const blocks = createMemo(() =>
    sections().flatMap((section) => section.items)
  );
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
    if (!item || !availableBlocks().includes(item)) return false;

    trackLauncherItemUsage(item);
    item.keyDownHandler();
    props.onClose(shouldReturnFocus);

    return true;
  };

  const setLauncherSearchMode = (next: boolean) => {
    const selectedItem = blocks()[focusedIndex()];
    setLauncherSearchModePreference(next);

    if (!next) {
      setSearchQuery('');
    }
    setFocusedIndex(
      selectedItem ? Math.max(0, blocks().indexOf(selectedItem)) : 0
    );

    queueMicrotask(() => {
      if (next) {
        searchInputRef?.focus({ preventScroll: true });
      } else {
        ref?.focus({ preventScroll: true });
      }
    });
  };

  candidates().forEach((item) => {
    registerHotkey({
      hotkeyToken: item.hotkeyToken,
      hotkey: item.hotkey,
      scopeId: launcherScope,
      description: item.description,
      condition: () => !searchMode() && availableBlocks().includes(item),
      registrationType: item.registrationType,
      runWithInputFocused: item.runWithInputFocused,
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
        condition: () => !searchMode() && availableBlocks().includes(item),
        registrationType: item.registrationType,
        runWithInputFocused: item.runWithInputFocused,
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
    condition: () =>
      createMenuOpen() &&
      !availableBlocks().some((item) => item.hotkey === 'c'),
    registrationType: 'add',
    keyDownHandler: () => {
      setCreateMenuOpen(false);
      return true;
    },
  }).withGroup(hkGroup);

  const navUpHotkey = registerHotkey({
    hotkey: props.horizontalNavigation
      ? ['arrowleft', 'arrowup', 'ctrl+k', 'shift+tab']
      : ['arrowup', 'ctrl+k', 'shift+tab'],
    scopeId: launcherScope,
    description: 'Navigate up',
    keyDownHandler: (event) => {
      if (
        event?.key === 'ArrowLeft' &&
        event.target instanceof HTMLInputElement
      )
        return false;
      event?.preventDefault();
      return listController.selectPrevious();
    },
    runWithInputFocused: true,
  }).withGroup(hkGroup);

  const navDownHotkey = registerHotkey({
    hotkey: props.horizontalNavigation
      ? ['arrowright', 'arrowdown', 'ctrl+j', 'tab']
      : ['arrowdown', 'ctrl+j', 'tab'],
    scopeId: launcherScope,
    description: 'Navigate down',
    keyDownHandler: (event) => {
      if (
        event?.key === 'ArrowRight' &&
        event.target instanceof HTMLInputElement
      )
        return false;
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
    runWithInputFocused: true,
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
    // The shared shell stopped painting its own pane (cmd+k gets one from the
    // app Dialog wrapper); this raw-Kobalte dialog carries it here.
    <div
      class={cn(
        'elevated-surface create-menu-pane w-200 max-w-[calc(100vw-16px)] touch:mobile-sheet touch:overflow-hidden touch:pb-[var(--mobile-sheet-safe-padding,0px)]',
        props.class
      )}
    >
      <div
        aria-hidden="true"
        class="hidden touch:flex h-5 shrink-0 items-center justify-center"
      >
        <div class="h-1 w-9 rounded-full bg-ink/15" />
      </div>
      <CommandMenuShell
        depth={2}
        hideBorder
        class="h-auto w-full max-h-[75vh] outline-none touch:rounded-none"
        ref={ref}
        tabindex={-1}
      >
        <CommandMenuShell.Header>
          <Show
            when={searchMode()}
            fallback={
              <div class="min-w-0 flex h-7 flex-1 items-center gap-2 text-ink-muted">
                <PlusIcon class="size-4 shrink-0 text-ink-extra-muted" />
                <h1 class="truncate text-base font-normal">Create New</h1>
              </div>
            }
          >
            <div class="min-w-0 flex h-7 flex-1 items-center gap-2">
              <MagnifyingGlassIcon class="size-4 shrink-0 text-ink-extra-muted" />
              <CommandMenuSearchInput
                ref={searchInputRef}
                type="text"
                placeholder="Search create options"
                value={searchQuery()}
                onInput={(event) => {
                  setSearchQuery(event.currentTarget.value);
                  setFocusedIndex(0);
                }}
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
                  class="border-ink/12 px-2 py-0.5"
                />
              </span>
            }
            labelClass="flex items-center"
            controlClass="bg-ink-extra-muted/25 data-checked:bg-accent"
            class="ml-auto flex-row-reverse gap-1.5 px-2 py-1"
          />
        </CommandMenuShell.Header>
        <CommandMenuShell.Body class="touch:flex touch:flex-col">
          {props.children({
            sections,
            blocks,
            selectedIndex: focusedIndex,
            searchMode,
            itemId: (item) => `create-menu-${launcherItemKey(item)}`,
            select: listController.setSelectedIndexFromPointer,
            step: (direction) => {
              const count = blocks().length;
              if (count)
                listController.setSelectedIndex(
                  (((focusedIndex() + direction) % count) + count) % count
                );
            },
            choose: runLauncherItem,
            scrollSelectedIntoView: listController.shouldScrollSelectedIntoView,
          })}
        </CommandMenuShell.Body>
        <CommandMenuShell.Footer class="touch:px-6 touch:py-4">
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
              <div class="flex w-7 justify-center border border-ink/12 text-xxs rounded-md items-center px-1.5 py-px font-normal">
                <Hotkey
                  shortcut={searchMode() ? 'arrowup' : navUpHotkey.hotkey()}
                  class="space-x-1"
                />
              </div>
              <div class="flex w-7 justify-center border border-ink/12 text-xxs rounded-md items-center px-1.5 py-px font-normal">
                <Hotkey
                  shortcut={searchMode() ? 'arrowdown' : navDownHotkey.hotkey()}
                  class="space-x-1"
                />
              </div>
            </div>
            Navigate
          </span>
          <span class="flex items-center gap-1">
            <div class="flex w-7 justify-center border border-ink/12 text-xxs rounded-md items-center px-1.5 py-px font-normal">
              <Hotkey shortcut={confirmHotkey.hotkey()} />
            </div>
            Create
          </span>
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
                    : 'border-ink/12'
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

const DetailsLauncher = lazy(() => import('./DetailsLauncher'));
const CarouselLauncher = lazy(() => import('./CarouselLauncher'));

export const LauncherInner = (props: LauncherInnerProps) => {
  const carouselFlag = useFeatureFlag(enableCarouselCreateMenu);
  return (
    <Suspense>
      <Show
        when={carouselFlag().enabled}
        fallback={<DetailsLauncher {...props} />}
      >
        <CarouselLauncher {...props} />
      </Show>
    </Suspense>
  );
};

type LauncherProps = {
  open: boolean;
  onOpenChange: (open: boolean, shouldReturnFocus?: boolean) => void;
};

function MobileLauncher(props: LauncherProps) {
  const availableBlocks = useCreateMenuBlocks();
  const items = createMemo(() =>
    sortLauncherBlocks(availableBlocks(), launcherFrecencyStore)
  );
  return (
    <MobileCreateSheet
      open={props.open}
      onOpenChange={props.onOpenChange}
      items={items()}
      onSelect={(item) => {
        trackLauncherItemUsage(item);
        item.keyDownHandler();
        props.onOpenChange(false);
      }}
    />
  );
}

export const Launcher = (props: LauncherProps) => (
  <Show when={isMobile()} fallback={<DesktopLauncher {...props} />}>
    <MobileLauncher {...props} />
  </Show>
);

const DesktopLauncher = (props: LauncherProps) => {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange} modal={true}>
      <Dialog.Portal>
        <Dialog.Overlay class="fixed inset-0 z-modal scrim-glass dialog-overlay-open-animation" />
        <Dialog.Content
          aria-label="Create New"
          class="fixed inset-x-0 top-0 bottom-(--virtual-keyboard-height,0) z-modal flex items-start justify-center px-2 pt-[10vh] outline-none [--color-surface:var(--color-dialog)]"
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  );
};
