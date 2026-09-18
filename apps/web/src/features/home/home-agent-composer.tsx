import { startPendingSession } from '@app/features/block-agent/context/pending-session';
import { useSplitPanelOrThrow } from '@components/app/split-layout/layoutUtils';
import { useChatInputContext } from '@core/component/AI/context';
import { toast } from '@core/component/Toast/Toast';
import { useSettingsState } from '@core/constant/SettingsState';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import { createEffect, createSignal } from 'solid-js';
import '../agents-view/agents-view.css';
import { modeForKind } from '../agents-view/core/agent-kind';
import { kindForBot } from '../agents-view/core/roster';
import { agentsRouteId } from '../agents-view/core/route';
import { createAgentRosterSource } from '../agents-view/queries/agent-roster-source';
import {
  NewChatPage,
  type StartConversation,
} from '../agents-view/views/NewChatPage';
import { buildHomeAgentPrompt } from './queries/home-agent-prompt';

/** Home supplies suggestions and navigation to the same composer used by Agents. */
export function HomeAgentComposer(props: { autoFocus?: boolean }) {
  const panel = useSplitPanelOrThrow();
  const input = useChatInputContext();
  const roster = createAgentRosterSource();
  const settings = useSettingsState();
  const [draft, setDraft] = createSignal('');
  let focus: (() => void) | undefined;
  let draftVersion = 0;
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
  const start = (conversation: StartConversation) => {
    const id = startPendingSession(conversation);
    panel.handle.replace({
      next: {
        type: 'component',
        id: agentsRouteId({
          mode: modeForKind(kindForBot(conversation.botId, roster.roster())),
          conversation: { type: 'agent_session', id },
        }),
      },
    });
  };
  return (
    <div class="agents-view-portal min-w-0 [&_.newchat]:p-0">
      <NewChatPage
        roster={roster.roster()}
        rosterLoading={roster.loading()}
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
