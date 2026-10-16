import {
  createPollAction,
  FORM_ACTION,
} from '@app/features/block-form/composer-actions';
import type { Action } from '@core/component/LexicalMarkdown/plugins/actions/types';
import { enableForms, isFeatureEnabled } from '@core/constant/featureFlags';
import {
  createConfiguredMessageEditor,
  type MessageEditorOptions,
} from '@core/messages/configured-message-editor';

/**
 * With forms on, channel composers offer `/form`; one that can send
 * (`sendMessage`) also offers `/poll`, which posts the poll at once.
 */
export function channelComposerActions(sendMessage?: () => void): Action[] {
  if (!isFeatureEnabled(enableForms)) return [];
  return sendMessage
    ? [createPollAction(sendMessage), FORM_ACTION]
    : [FORM_ACTION];
}

/**
 * Channel surfaces add group mentions, the floating format menu and the
 * channel's own actions (`channelComposerActions`) to common editor setup.
 */
export function createConfiguredChannelMarkdownEditor({
  sendMessage,
  ...options
}: MessageEditorOptions & { sendMessage?: () => void }) {
  const actions = channelComposerActions(sendMessage);
  return createConfiguredMessageEditor({
    groupMentions: true,
    floatingFormatMenu: true,
    additionalActions: actions.length ? actions : undefined,
    ...options,
  });
}
