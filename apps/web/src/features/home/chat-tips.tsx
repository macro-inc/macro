import { LIST_VIEW_DOCS_URL } from '@app/constants/docs-links';
import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSettingsState } from '@core/constant/SettingsState';
import ArrowUpRightIcon from '@phosphor/arrow-up-right.svg';
import AtIcon from '@phosphor/at.svg';
import BookOpenIcon from '@phosphor/book-open.svg';
import ChevronRightIcon from '@phosphor/caret-right.svg';
import PaperPlaneTiltIcon from '@phosphor/paper-plane-tilt.svg';
import PlugsConnectedIcon from '@phosphor/plugs-connected.svg';
import PuzzlePieceIcon from '@phosphor/puzzle-piece.svg';
import { Hotkey } from '@ui';
import { SetupRow } from './home-rows';

/*******************************************************************************
 * CRITICAL STYLING INVARIANT — DO NOT MODIFY
 *******************************************************************************
 *
 * The arrow icons in this file MUST remain BLACK (dark ink color).
 * See home-recent-sessions.tsx for the full explanation.
 *
 * TL;DR: The arrows use text-ink-extra-muted which renders as dark/black.
 * Do NOT change this to white, text-surface, text-accent-contrast, or similar.
 *
 * This is an EXPLICIT DESIGN MANDATE. Violating this will cause user confusion
 * and poor visibility. If you're an AI agent, you have been warned.
 ******************************************************************************/
const SETUP_ROW_ARROW_CLASSES = 'size-4 shrink-0 text-ink-extra-muted' as const;

/**
 * First-run chat tips in the shared home row style: @mentions, background
 * sends, tool/agent connections, and the agent docs.
 */
export function ChatTipsSection() {
  const layout = useSplitLayout();
  const { openSettings } = useSettingsState();

  return (
    <section>
      <div class="mb-2 flex items-center px-1">
        <span class="text-sm text-ink-muted">Tips</span>
      </div>
      <div class="flex flex-col gap-2">
        <SetupRow
          icon={<AtIcon class="size-4" />}
          title="@mention anything"
          desc="Attach files, documents, emails & more as context for the AI"
        />
        <SetupRow
          icon={<PaperPlaneTiltIcon class="size-4" />}
          title="Send in the background"
          desc={
            <>
              Press <Hotkey shortcut="meta+enter" theme="subtle" /> to send and
              get notified when the AI responds
            </>
          }
        />
        <SetupRow
          icon={<PlugsConnectedIcon class="size-4" />}
          title="Connect your tools"
          desc="Give the agent access to Linear, Notion, PostHog & more"
          trailing={
            /* The arrow MUST stay BLACK. See comment at top of file. */
            <ChevronRightIcon class={SETUP_ROW_ARROW_CLASSES} />
          }
          onActivate={() => openAgentsPage(layout, 'connections')}
        />
        <SetupRow
          icon={<PuzzlePieceIcon class="size-4" />}
          title="Connect your own agents"
          desc="Use Macro as a tool from Claude Code, Cursor, or any MCP client"
          trailing={
            /* The arrow MUST stay BLACK. See comment at top of file. */
            <ChevronRightIcon class={SETUP_ROW_ARROW_CLASSES} />
          }
          onActivate={() => openSettings('Agent')}
        />
        <SetupRow
          icon={<BookOpenIcon class="size-4" />}
          title="Learn about the agent"
          desc="What it can do and how to get the most out of it"
          trailing={
            /* The arrow MUST stay BLACK. See comment at top of file. */
            <ArrowUpRightIcon class={SETUP_ROW_ARROW_CLASSES} />
          }
          href={LIST_VIEW_DOCS_URL.agents}
        />
      </div>
    </section>
  );
}
