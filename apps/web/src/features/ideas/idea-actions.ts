import { openAgentsPage } from '@app/features/agents-view/primitives/open-page';
import { getChannelParams } from '@app/features/block-channel/utils/link';
import { openCalendarView } from '@app/features/calendar-view/calendar-navigation';
import { openChatWithInput } from '@app/features/chat/ChatWithAgentButton';
import { URL_PARAMS as EMAIL_URL_PARAMS } from '@app/features/email-thread/core/location';
import { projectHostedContent } from '@app/features/projects/open-project';
import type {
  SplitContent,
  SplitManager,
} from '@components/app/split-layout/layoutManager';
import { fileTypeToBlockName } from '@core/constant/allBlocks';
import type { IdeaActions } from './context/ideas-source';
import type { IdeaTarget } from './core/idea';

/** The split an idea's item opens in, or undefined for items with no view. */
function targetContent(target: IdeaTarget): SplitContent | undefined {
  const { entityType, entityId, partId } = target;

  if (entityType === 'email_thread') {
    return {
      type: 'email',
      id: entityId,
      params: partId ? { [EMAIL_URL_PARAMS.messageId]: partId } : undefined,
    };
  }

  if (entityType === 'channel') {
    return {
      type: 'channel',
      id: entityId,
      params: partId ? getChannelParams(partId) : undefined,
    };
  }

  if (entityType === 'initiative') {
    return projectHostedContent(entityId, 'overview');
  }

  const block = fileTypeToBlockName(entityType);
  if (block === 'unknown') return undefined;

  return { type: block, id: entityId };
}

type RoutineIdeaActions = Pick<
  IdeaActions,
  'routineText' | 'reviewRoutine' | 'turnOnRoutine'
>;

/** A card's actions over the app's splits, composer and routine suggestions. */
export function createIdeaActions(
  layout: Pick<SplitManager, 'openWithSplit'>,
  routines: RoutineIdeaActions
): IdeaActions {
  const openItem = (target: IdeaTarget) => {
    if (target.entityType === 'scheduled_action') {
      openAgentsPage(layout, 'routines', { routineId: target.entityId });
      return;
    }

    if (target.entityType === 'calendar_event') {
      openCalendarView({ eventId: target.entityId }, { openInNewSplit: true });
      return;
    }

    const content = targetContent(target);
    if (!content) return;

    layout.openWithSplit(content, { activate: true, preferNewSplit: true });
  };

  return {
    ...routines,
    openComposer: (prompt) => openChatWithInput(prompt),
    openItem,
    // A reply draft lives in its thread, which shows it ready to edit.
    openDraft: (draft) =>
      openItem({ entityType: draft.entityType, entityId: draft.entityId }),
  };
}
