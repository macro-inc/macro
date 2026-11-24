import { t } from '@app/lib/i18n';
import { useSplitLayout } from '@components/app/split-layout/layout';
import { useSplitPanel } from '@components/app/split-layout/layoutUtils';
import type { UserCardAction } from '@core/component/userCardActions';
import DesktopIcon from '@icon/system/regular/desktop.svg';
import { useHarnessesQuery } from '@queries/harnesses/harnesses';
import type { Accessor } from 'solid-js';
import { agentScreenContent } from './core/route';

/**
 * The harness of the agent teammate `userId` names, when the viewer may watch
 * its screen (`View` on the computer: any access but none). `undefined` for
 * people, for agents without a computer, and while the list loads.
 */
export function useAgentScreenHarnessId(
  userId: Accessor<string | undefined>
): Accessor<string | undefined> {
  const harnesses = useHarnessesQuery();

  return () => {
    const id = userId();
    if (!id || !harnesses.isSuccess) return undefined;
    const harness = harnesses.data.find(
      (each) => each.team_agent_user_id === id
    );
    if (!harness || !harness.access || harness.access === 'none') {
      return undefined;
    }
    return harness.id;
  };
}

/** Opens the screen beside the current split (a pane of its own on phones). */
export function useOpenAgentScreen() {
  const { openWithSplit } = useSplitLayout();
  return (harnessId: string) =>
    openWithSplit(agentScreenContent(harnessId), { preferNewSplit: true });
}

/**
 * Opens the screen in place of the split this is called from, so it is in
 * front at once and Back returns there. For a surface that should step aside
 * for the screen (Settings → Machines); without a split it opens one.
 */
export function useOpenAgentScreenInPlace() {
  const panel = useSplitPanel();
  const openBeside = useOpenAgentScreen();
  return (harnessId: string) => {
    if (!panel) {
      openBeside(harnessId);
      return;
    }
    panel.handle.replace({ next: agentScreenContent(harnessId) });
  };
}

/** The member card's View screen, for an agent teammate the viewer may watch. */
export function createScreenUserCardAction(
  userId: Accessor<string | undefined>
): Accessor<UserCardAction | undefined> {
  const harnessId = useAgentScreenHarnessId(userId);
  const openScreen = useOpenAgentScreen();

  return () => {
    const id = harnessId();
    if (!id) return undefined;
    return {
      id: 'view-screen',
      label: t('agentScreen.viewScreen'),
      icon: DesktopIcon,
      onSelect: (event) => {
        event.preventDefault();
        event.stopPropagation();
        openScreen(id);
      },
    };
  };
}
