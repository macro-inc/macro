/**
 * The channel composer's `/poll` and `/form` (RFC 03 §3). Only these light
 * descriptions load with every composer; picking one loads the forms code.
 */
import type { Action } from '@core/component/LexicalMarkdown/plugins/actions/types';
import { ActionCategory } from '@core/component/LexicalMarkdown/plugins/actions/types';
import ChartBar from '@phosphor/chart-bar.svg';
import ClipboardText from '@phosphor/clipboard-text.svg';

/** `/poll`, for a composer that can send: the poll posts as soon as it is made. */
export function createPollAction(sendMessage: () => void): Action {
  return {
    id: 'poll',
    name: 'Poll',
    keywords: ['poll', 'vote', 'survey', 'question'],
    category: ActionCategory.ELEMENT,
    icon: ChartBar,
    action: async (editor) => {
      const { openPollComposer } = await import('./form-composer-actions');
      openPollComposer(editor, sendMessage);
    },
  };
}

export const FORM_ACTION: Action = {
  id: 'form',
  name: 'Form',
  keywords: ['form', 'questionnaire', 'survey', 'rsvp'],
  category: ActionCategory.ELEMENT,
  icon: ClipboardText,
  action: async (editor) => {
    const { startFormInMessage } = await import('./form-composer-actions');
    await startFormInMessage(editor);
  },
};
