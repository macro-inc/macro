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
import { fireAndForget } from '@core/util/fireAndForget';
import { getItemPreview } from '@queries/preview/preview';
import { isAccessiblePreviewItem } from '@queries/preview/types';
import type { SuggestionActions } from './context/suggestions-source';
import type { SuggestionTarget } from './core/suggestion';

/** The split an suggestion's item opens in, or undefined for items with no view. */
function targetContent(target: SuggestionTarget): SplitContent | undefined {
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

type RoutineSuggestionActions = Pick<
  SuggestionActions,
  'reviewRoutine' | 'turnOnRoutine'
>;

/** A card's actions over the app's splits, composer and routine suggestions. */
export function createSuggestionActions(
  layout: Pick<SplitManager, 'openWithSplit'>,
  routines: RoutineSuggestionActions
): SuggestionActions {
  const openItem = (target: SuggestionTarget) => {
    if (target.entityType === 'scheduled_action') {
      openAgentsPage(layout, 'routines', { routineId: target.entityId });
      return;
    }

    if (target.entityType === 'calendar_event') {
      openCalendarView({ eventId: target.entityId }, { openInNewSplit: true });
      return;
    }

    if (target.entityType === 'document') {
      fireAndForget(openDocument(target.entityId), 'suggestions');
      return;
    }

    const content = targetContent(target);
    if (!content) return;

    layout.openWithSplit(content, { activate: true, preferNewSplit: true });
  };
  /**
   * A document's view depends on its file type, which a suggestion doesn't
   * carry: read it, then open that view. One the person can't read opens as
   * a note, whose view says so.
   */
  const openDocument = async (id: string) => {
    const preview = await getItemPreview({ id, type: 'document' });
    const fileType = isAccessiblePreviewItem(preview)
      ? preview.fileType
      : undefined;
    const block = fileTypeToBlockName(fileType ?? 'md');

    layout.openWithSplit(
      { type: block === 'unknown' ? 'md' : block, id },
      { activate: true, preferNewSplit: true }
    );
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
