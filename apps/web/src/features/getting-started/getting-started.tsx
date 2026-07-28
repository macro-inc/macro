import { DOCS_BASE } from '@app/constants/docs-links';
import { HomeBackfillProgress } from '@app/features/home/home-backfill-progress';
import { InteractiveOnboardingModal } from '@app/features/onboarding/InteractiveOnboardingModal';
import { useSplitLayout } from '@components/app/split-layout/layout';
import type { SplitContent } from '@components/app/split-layout/layoutManager';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useHasPaidAccess } from '@core/auth/license';
import { defaultModelForPlan } from '@core/component/AI/constant';
import { setPendingSendData } from '@core/component/AI/signal/pendingSend';
import { deriveChatName } from '@core/component/AI/util/deriveName';
import { toast } from '@core/component/Toast/Toast';
import {
  type SettingsTab,
  useSettingsState,
} from '@core/constant/SettingsState';
import { useUserId, useUserInfo } from '@core/context/user';
import { isMobile } from '@core/mobile/isMobile';
import { setActiveTabId } from '@core/signal/settingsTab';
import { createChat } from '@core/util/create';
import { AnimatedProfileIcon } from '@icon/wide-profile';
import BookOpenIcon from '@phosphor/book-open.svg';
import PaletteIcon from '@phosphor/palette.svg';
import PlayCircleIcon from '@phosphor/play-circle.svg';
import PlugsIcon from '@phosphor/plugs.svg';
import { useGithubLinkStatusQuery } from '@queries/auth/github-link';
import { isRealNamePart, useOwnUserName } from '@queries/auth/user-name-self';
import { useEmailLinksQuery } from '@queries/email/link';
import { useMcpServersQuery } from '@queries/mcp-servers';
import { useStarterDocsQuery } from '@queries/starter-docs';
import {
  currentThemeId,
  darkModeTheme,
  lightModeTheme,
  themeMode,
} from '@theme/signals/themeSignals';
import { createEffect, createSignal, For, on, onMount, Show } from 'solid-js';
import { AGENT_EXAMPLES } from './agent-examples';
import { ActionRow, SectionHeader } from './getting-started-rows';
import {
  GettingStartedProvider,
  useGettingStartedState,
} from './getting-started-state';
import type {
  GettingStartedAction,
  GettingStartedSection as GettingStartedSectionConfig,
} from './getting-started-types';

/**
 * Where new users arrive: activating actions in collapsible sections. Acts as
 * a Preview Pair Controller — action results open in the adjacent Viewer.
 */
export function GettingStarted() {
  const userId = useUserId();

  return (
    <Show when={userId()} keyed>
      {(id) => (
        <GettingStartedProvider userId={id}>
          <GettingStartedContent />
        </GettingStartedProvider>
      )}
    </Show>
  );
}

function GettingStartedContent() {
  const panel = useSplitPanelOrThrow();
  const state = useGettingStartedState();
  const { openWithSplit } = useSplitLayout();
  const { openSettingsInSplit } = useSettingsState();

  // Poll: MCP OAuth completes in a popup opened from the Connections panel,
  // and if this window never blurs no focus refetch would ever flip the row
  // (see ConnectorsSection).
  const mcpServers = useMcpServersQuery({
    refetchInterval: 4_000,
    neverSuspend: true,
  });
  const emailLinks = useEmailLinksQuery();
  const githubLink = useGithubLinkStatusQuery();
  const userInfo = useUserInfo();
  const ownUserName = useOwnUserName();
  const starterDocs = useStarterDocsQuery();
  const hasPaidAccess = useHasPaidAccess();

  // The interactive tutorial, replayed on demand. Root auto-opens its own copy
  // for first-time users; this one is always a replay, so it never passes
  // isFirstTimeOnboarding.
  const [tutorialOpen, setTutorialOpen] = createSignal(false);

  /**
   * Open content beside the list: re-engage a manually-closed Viewer first so
   * the open lands there instead of replacing this panel, then route through
   * this panel's handle (a Controller-handle open is rewritten into its
   * Viewer). No-ops into a plain open on mobile or when there's no room.
   */
  const openInPreview = (content: SplitContent) => {
    if (
      !isMobile() &&
      !panel.handle.isControllerSplit() &&
      panel.handle.canEngagePreview()
    ) {
      panel.handle.engagePreview();
    }
    openWithSplit(content, { handle: panel.handle });
  };

  const openSettingsTab = (tab: SettingsTab) => {
    setActiveTabId(tab);
    if (isMobile()) {
      // Mobile has no Preview Pair; the docked settings split is the
      // full-screen path there.
      openSettingsInSplit(tab);
      return;
    }
    // Deliberately not openSettings(): on desktop it collapses to solo
    // settings, destroying the Controller/Viewer pair.
    openInPreview({ type: 'component', id: 'settings' });
  };

  const openChatPrompt = async (prompt: string): Promise<boolean> => {
    const result = await createChat(
      { name: deriveChatName(prompt) },
      { source: 'getting-started' }
    );
    if ('error' in result || !result.chatId) {
      toast.failure('Unable to start chat');
      return false;
    }
    // The chat block consumes this on mount and sends immediately. The model
    // must be one this plan may use: a pending send bypasses ChatInput, whose
    // effect would otherwise correct an unavailable model, and the backend
    // rejects premium models for free users with a 403 (surfaced as a
    // paywall, with the send silently dropped).
    setPendingSendData({
      content: prompt,
      attachments: [],
      model: defaultModelForPlan(hasPaidAccess()),
    });
    openInPreview({ type: 'chat', id: result.chatId });
    return true;
  };

  /**
   * The deterministic id of the how-to guide seeded at signup. Undefined
   * while the query is in flight; gated on isSuccess so a render-time read
   * can't suspend the page.
   */
  const howToGuideId = () =>
    starterDocs.isSuccess ? starterDocs.data.howToGuideId : undefined;

  const sections: GettingStartedSectionConfig[] = [
    {
      id: 'connect-tools',
      title: 'Connect your tools',
      actions: [
        {
          id: 'connect-tools',
          icon: PlugsIcon,
          title: 'Connect your tools',
          description: 'Link your inbox, GitHub, Linear, Notion & more',
          onActivate: () => openSettingsTab('Connected'),
          // Any real connection counts: a second inbox (onboarding links the
          // first), the GitHub account link, or any authenticated MCP server.
          isComplete: () =>
            (emailLinks.data?.links.length ?? 0) > 1 ||
            githubLink.data?.status === 'linked' ||
            (mcpServers.data ?? []).some((server) => server.authenticated),
        },
      ],
    },
    {
      id: 'basics',
      title: 'Set up your account',
      actions: [
        {
          id: 'play-tutorial',
          icon: PlayCircleIcon,
          title: 'Play the Macro tutorial',
          description: "Take a quick tour of Macro's core features",
          onActivate: () => setTutorialOpen(true),
        },
        {
          id: 'how-to-guide',
          icon: BookOpenIcon,
          title: 'Macro how to guide',
          description: 'Learn about how Macro works',
          // Falls back to the public docs site when the id can't be resolved.
          onActivate: () => {
            const documentId = howToGuideId();
            if (!documentId) {
              window.open(DOCS_BASE, '_blank', 'noopener,noreferrer');
              return;
            }
            openInPreview({ type: 'md', id: documentId });
          },
        },
        {
          id: 'set-name',
          icon: AnimatedProfileIcon,
          title: 'Set your name & profile picture',
          description: 'Introduce yourself in Account settings',
          onActivate: () => openSettingsTab('Account'),
          // The editable first/last name (what Account settings writes); the
          // legacy identity-provider display name also counts.
          isComplete: () =>
            isRealNamePart(ownUserName()?.first_name) ||
            isRealNamePart(ownUserName()?.last_name) ||
            Boolean(userInfo()?.name?.trim()),
        },
        {
          id: 'choose-theme',
          icon: PaletteIcon,
          title: 'Choose your theme',
          description: 'Light, dark, or completely custom',
          onActivate: () => openSettingsTab('Appearance'),
          // Any theme-picker interaction while the page is mounted; defer
          // skips the mount value.
          observe: (markComplete) =>
            createEffect(
              on(
                [currentThemeId, themeMode, lightModeTheme, darkModeTheme],
                markComplete,
                { defer: true }
              )
            ),
        },
      ],
    },
    {
      id: 'agent-examples',
      title: "Put Macro's agent to work",
      actions: AGENT_EXAMPLES.map((example) => ({
        id: example.id,
        icon: example.icon,
        title: example.title,
        description: example.description,
        onActivate: () => openChatPrompt(example.prompt),
      })),
    },
  ];

  // Register per-action completion observers, once, under this component's
  // reactive owner. No persisted-completion guard: the store loads async and
  // markCompleted dedupes.
  for (const action of sections.flatMap((section) => section.actions)) {
    action.observe?.(() => state.markCompleted(action.id));
  }

  const activate = async (action: GettingStartedAction) => {
    const result = await action.onActivate();
    // Default rule: an action declaring no live/observed completion source
    // completes on successful activation.
    if (result !== false && !action.isComplete && !action.observe) {
      state.markCompleted(action.id);
    }
  };

  const isComplete = (action: GettingStartedAction): boolean =>
    (action.isComplete?.() ?? false) || state.isPersistedComplete(action.id);

  const sectionProgress = (section: GettingStartedSectionConfig) => ({
    completed: section.actions.filter(isComplete).length,
    total: section.actions.length,
  });

  onMount(() => {
    panel.handle.setDisplayName('Getting started');
    // Preview is always on for Getting Started (no user toggle): engage
    // whenever this panel isn't itself someone's Viewer. engagePreview
    // no-ops on mobile and when there's no room; action opens re-engage if
    // the Viewer was closed (see openInPreview).
    if (panel.handle.isViewerSplit()) return;
    panel.handle.engagePreview();
  });

  return (
    <main class="relative flex h-full flex-col bg-surface">
      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 pb-6 pt-6">
          <header class="px-1">
            <h1 class="text-xl font-semibold text-ink">Getting Started</h1>
            <p class="text-sm text-ink-muted">
              A few actions to get the most out of Macro.
            </p>
          </header>
          {/* Renders nothing once no inbox is importing. */}
          <HomeBackfillProgress />
          <For each={sections}>
            {(section) => (
              <GettingStartedSection
                section={section}
                activate={activate}
                isComplete={isComplete}
                sectionProgress={sectionProgress}
              />
            )}
          </For>
        </div>
      </div>
      <InteractiveOnboardingModal
        open={tutorialOpen()}
        onOpenChange={setTutorialOpen}
      />
    </main>
  );
}

function GettingStartedSection(props: {
  section: GettingStartedSectionConfig;
  activate: (action: GettingStartedAction) => Promise<void>;
  isComplete: (action: GettingStartedAction) => boolean;
  sectionProgress: (section: GettingStartedSectionConfig) => {
    completed: number;
    total: number;
  };
}) {
  const state = useGettingStartedState();
  const progress = () => props.sectionProgress(props.section);

  return (
    <section>
      <SectionHeader
        section={props.section}
        collapsed={state.isCollapsed(props.section.id)}
        completed={progress().completed}
        total={progress().total}
        onToggle={() => state.toggleSection(props.section.id)}
      />
      <Show when={!state.isCollapsed(props.section.id)}>
        <div class="mt-2 flex flex-col gap-2">
          <For each={props.section.actions}>
            {(action) => (
              <ActionRow
                action={action}
                complete={props.isComplete(action)}
                onActivate={() => void props.activate(action)}
              />
            )}
          </For>
        </div>
      </Show>
    </section>
  );
}
