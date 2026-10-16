import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useChatInputContext } from '@core/component/AI/context';
import { toast } from '@core/component/Toast/Toast';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { useWarmAgentSessionQuery } from '@queries/agent-session/warm';
import { createEffect, onCleanup } from 'solid-js';
import '../agents-view/agents-view.css';
import {
  createPersistedComposerDraft,
  HOME_CONVERSATION_DRAFT_KEY,
} from '../agents-view/primitives/composer-draft';
import { createAgentRosterSource } from '../agents-view/queries/agent-roster-source';
import {
  NewChatPage,
  type StartConversation,
} from '../agents-view/views/NewChatPage';
import { useHomeView } from './home-view-context';
import { buildHomeAgentPrompt } from './queries/home-agent-prompt';

/** Home supplies suggestions and its detail pane to the same composer used by Agents. */
export function HomeAgentComposer(props: { autoFocus?: boolean }) {
  const panel = useSplitPanelOrThrow();
  const home = useHomeView();
  const input = useChatInputContext();
  const roster = createAgentRosterSource();
  const settings = useSettingsState();
  const userId = useUserId();
  useWarmAgentSessionQuery(userId);
  const { draft, setDraft } = createPersistedComposerDraft(
    HOME_CONVERSATION_DRAFT_KEY,
    userId
  );
  let focus: (() => void) | undefined;
  let draftVersion = 0;
  onCleanup(() => {
    // A suggestion started on a previous visit must not overwrite saved text.
    draftVersion++;
  });
  const applySuggestion = async (content: string) => {
    const version = ++draftVersion;
    try {
      const prompt = await buildHomeAgentPrompt({
        content,
        attachments: input.attachments.attached(),
      });
      if (version !== draftVersion) return;
      setDraft(prompt);
      input.attachments.setAttached([]);
      focus?.();
    } catch (error) {
      if (version !== draftVersion) return;
      setDraft(content);
      toast.failure(
        error instanceof Error
          ? error.message
          : 'Could not load the suggested context.'
      );
    }
  };
  createEffect(() => {
    const requested = input.pendingDraft();
    if (requested == null) return;
    input.setPendingDraft(null);
    void applySuggestion(requested);
  });
  registerHotkey({
    hotkey: 'enter',
    scopeId: panel.splitHotkeyScope,
    description: 'Focus Chat Input',
    hotkeyToken: TOKENS.block.focus,
    hide: true,
    keyDownHandler: () => {
      focus?.();
      return true;
    },
  });
  // The session opens in Home's detail pane rather than Agents; its row joins
  // the Home list once the create answers.
  const start = (conversation: StartConversation) => {
    const id = startPendingSession({
      ...conversation,
      userId: userId(),
      submitSurface: 'home',
    });
    home.openPreview({ type: 'agent_session', id });
  };
  return (
    <div class="agents-view-portal min-w-0 [&_.newchat]:p-0">
      <NewChatPage
        roster={roster.roster()}
        rosterLoading={roster.loading()}
        availabilityLoading={roster.availabilityLoading()}
        draft={draft()}
        onDraftChange={(value) => {
          draftVersion++;
          setDraft(value);
        }}
        autoFocus={props.autoFocus}
        registerFocus={(callback) => {
          focus = callback;
        }}
        onStart={start}
        onOpenRoster={() => settings.openSettings('Agents')}
      />
    </div>
  );
}
