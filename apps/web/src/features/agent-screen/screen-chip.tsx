import { t } from '@app/lib/i18n';
import { MentionContainer } from '@core/component/LexicalMarkdown/component/decorator/DocumentMention';
import { getDisplayName, tryMacroId } from '@core/user';
import DesktopIcon from '@icon/system/regular/desktop.svg';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import type { JSX } from 'solid-js';
import { cachedRecord } from './queries/cached-record';
import {
  parseScreenReference,
  type ScreenReference,
  screenPath,
} from './screen-reference';
import { useOpenAgentScreen } from './screen-user-action';

/**
 * An agent computer's screen in text, as a chip: "Dee's screen". A click
 * opens the screen to watch, beside the current split, on this origin; taking
 * over stays the viewer's own action. A screen the viewer can't see (or one
 * not loaded yet) still opens the viewer, which says so.
 */
export function ScreenChip(props: { reference: ScreenReference }) {
  const harnesses = useHarnessesQuery();
  const openScreen = useOpenAgentScreen();
  const harness = () =>
    cachedRecord(harnesses, (each) => each.id === props.reference.harnessId);
  const agentName = () => {
    const agentUserId = harness()?.team_agent_user_id;
    return (
      (agentUserId ? getDisplayName(tryMacroId(agentUserId)) : '') ||
      harness()?.name ||
      ''
    );
  };
  const label = () => {
    const name = agentName();
    return name
      ? t('agentScreen.screenTitle', { name })
      : t('agentScreen.screenChipUnknown');
  };

  return (
    <a
      href={screenPath(props.reference)}
      data-screen-chip={props.reference.harnessId}
      aria-label={label()}
      class="rounded-xs hover:bg-hover focus-visible:outline-2 focus-visible:outline-ink/30"
      onClick={(event) => {
        // Modified clicks keep the browser's own handling (a new tab of this
        // origin's screen route).
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        openScreen(props.reference.harnessId);
      }}
    >
      <MentionContainer
        icon={<DesktopIcon class="size-full" />}
        text={label()}
      />
    </a>
  );
}

/** The chip for a link to an agent's screen; undefined for any other link. */
export function screenLinkChip(url: string): JSX.Element | undefined {
  const reference = parseScreenReference(url);
  return reference ? <ScreenChip reference={reference} /> : undefined;
}
