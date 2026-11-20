import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { useWarmAgentSessionQuery } from '@queries/agent-session/warm';
import '../agents-view/agents-view.css';
import {
  createPersistedComposerDraft,
  HOME_CONVERSATION_ATTACHMENTS_KEY,
  HOME_CONVERSATION_DRAFT_KEY,
} from '../agents-view/primitives/composer-draft';
import { createAgentRosterSource } from '../agents-view/queries/agent-roster-source';
import {
  NewChatPage,
  type StartConversation,
} from '../agents-view/views/NewChatPage';

/** Home supplies its saved draft and detail pane to the same composer used by Agents. */
export function HomeAgentComposer(props: {
  autoFocus?: boolean;
  /** Show the session the composer just started, beside the list. */
  onStarted: (sessionId: string) => void;
  /**
   * Leave Enter to a list registered earlier in the split while it has a row
   * to open, rather than taking the key from it.
   */
  shareEnter?: boolean;
}) {
  const panel = useSplitPanelOrThrow();
  const roster = createAgentRosterSource();
  const settings = useSettingsState();
  const userId = useUserId();
  useWarmAgentSessionQuery(userId);
  const { draft, setDraft } = createPersistedComposerDraft(
    HOME_CONVERSATION_DRAFT_KEY,
    userId
  );
  let focus: (() => void) | undefined;
  registerHotkey({
    hotkey: 'enter',
    scopeId: panel.splitHotkeyScope,
    description: 'Focus Chat Input',
    hotkeyToken: TOKENS.block.focus,
    registrationType: props.shareEnter ? 'add' : 'override',
    hide: true,
    keyDownHandler: () => {
      focus?.();
      return true;
    },
  });
  // The session opens in Home's detail pane rather than Agents; the server
  // lists its row as the viewer's work before the sandbox boots.
  const start = (conversation: StartConversation) => {
    const id = startPendingSession({
      ...conversation,
      userId: userId(),
      submitSurface: 'home',
    });
    props.onStarted(id);
  };
  return (
    <div class="agents-view-portal agents-scope min-w-0 [&_.newchat]:p-0">
      <NewChatPage
        homeLayout
        roster={roster.roster()}
        rosterLoading={roster.loading()}
        availabilityLoading={roster.availabilityLoading()}
        draft={draft()}
        attachmentsKey={HOME_CONVERSATION_ATTACHMENTS_KEY}
        onDraftChange={setDraft}
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
