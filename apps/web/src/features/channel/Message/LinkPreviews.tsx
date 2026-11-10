import { t } from '@app/lib/i18n';
import { LinkPreviewCard } from '@core/component/Link';
import { fireAndForget } from '@core/util/fireAndForget';
import XIcon from '@icon/system/regular/x.svg';
import type { LinkPreview } from '@service-storage/messages';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { useMessage, useMessageActions } from './context';

/**
 * Previews of the web pages a message links to, as cards beneath its text.
 * They come with the message, so the cards are there when it first renders.
 * Its sender can remove them: every card carries the same control, which
 * removes them all.
 */
export function LinkPreviews(props: { previews: LinkPreview[] }) {
  const message = useMessage();
  const actions = useMessageActions();

  return (
    <Show when={props.previews.length > 0}>
      <div data-message-link-previews>
        <For each={props.previews}>
          {(preview) => (
            <div class="mt-2">
              <LinkPreviewCard
                preview={preview}
                action={
                  <Show when={actions?.onRemoveLinkPreviews}>
                    {(onRemove) => (
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={t('channelLinkPreviews.remove')}
                        tooltip={t('channelLinkPreviews.remove')}
                        onClick={(event) => {
                          // Not a press on the message around the card.
                          event.stopPropagation();
                          fireAndForget(
                            onRemove()({ message: message(), event }),
                            'channel-message-actions'
                          );
                        }}
                      >
                        <XIcon class="size-4" />
                      </Button>
                    )}
                  </Show>
                }
              />
            </div>
          )}
        </For>
      </div>
    </Show>
  );
}
