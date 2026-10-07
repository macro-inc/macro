import {
  createPollAction,
  FORM_ACTION,
} from '@app/features/block-form/composer-actions';
import { enableForms, isFeatureEnabled } from '@core/constant/featureFlags';
import {
  createConfiguredMessageEditor,
  type MessageEditorOptions,
} from '@core/messages/configured-message-editor';

/**
 * Channel surfaces add group mentions, the floating format menu and, with
 * forms on, the `/form` action to common editor setup; a surface that can
 * send (`sendMessage`) also gets `/poll`, which posts the poll at once.
 */
export function createConfiguredChannelMarkdownEditor({
  sendMessage,
  ...options
}: MessageEditorOptions & { sendMessage?: () => void }) {
  return createConfiguredMessageEditor({
    groupMentions: true,
    floatingFormatMenu: true,
    additionalActions: isFeatureEnabled(enableForms)
      ? sendMessage
        ? [createPollAction(sendMessage), FORM_ACTION]
        : [FORM_ACTION]
      : undefined,
    ...options,
  });
}
