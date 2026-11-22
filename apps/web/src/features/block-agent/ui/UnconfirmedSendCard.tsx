/**
 * A prompt whose send got no answer and that neither the log nor the queue
 * showed. It may have run, so its text is not put back in the box (a resend
 * could run it twice), and it is not dropped either: the card keeps it, with
 * a copy, and a resend only after saying it may run twice. It goes away when
 * the prompt's row reaches the log.
 */

import { t } from '@app/lib/i18n';
import WarningCircle from '@icon/system/regular/warning-circle.svg';
import { Button, Card, Item } from '@ui';
import { createSignal, Show } from 'solid-js';

export interface UnconfirmedSendCardProps {
  /** The prompt's text as it was sent. */
  text: string;
  /** How many files rode it. */
  attachmentCount: number;
  /** A resend of it is in flight: its choices wait for the answer. */
  sending?: boolean;
  onCopy: () => void;
  /** Absent where there is no session to send it in again. */
  onSendAgain?: () => void;
  onDismiss: () => void;
}

export function UnconfirmedSendCard(props: UnconfirmedSendCardProps) {
  const [confirming, setConfirming] = createSignal(false);
  let sendAnyway: HTMLButtonElement | undefined;
  let sendAgain: HTMLButtonElement | undefined;
  const confirm = (on: boolean) => {
    setConfirming(on);
    // Keep focus on the choice that replaced the button pressed.
    queueMicrotask(() => (on ? sendAnyway : sendAgain)?.focus());
  };
  // Announced rather than focused: it can appear while the person types the
  // next message, and taking focus then would lose keystrokes.
  return (
    <Card
      variant="filled"
      depth={3}
      role="region"
      aria-label={t('agentSend.notConfirmedRegion')}
      aria-live="polite"
      class="mb-2 overflow-hidden text-ink"
    >
      <Card.Header class="pb-2">
        <Item class="items-start gap-3 border-0 p-0">
          <Item.Media class="text-failure">
            <WarningCircle />
          </Item.Media>
          <Item.Content class="gap-0.5">
            <Card.Title>{t('agentSend.notConfirmed')}</Card.Title>
            <Card.Description class="leading-5">
              {t('agentSend.notConfirmedBody')}
            </Card.Description>
            <p
              data-testid="unconfirmed-text"
              class="mt-1 line-clamp-3 text-sm text-ink wrap-anywhere"
            >
              {props.text}
            </p>
            <Show when={props.attachmentCount > 0}>
              <p class="text-xs text-ink-muted">
                {t('agentSend.filesAttached', {
                  count: props.attachmentCount,
                })}
              </p>
            </Show>
          </Item.Content>
        </Item>
      </Card.Header>
      <Card.Footer class="flex-wrap justify-end gap-2 border-0 pt-0">
        <Show
          when={confirming()}
          fallback={
            <>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={props.sending}
                onClick={props.onDismiss}
              >
                {t('agentSend.dismiss')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={props.onCopy}
              >
                {t('agentSend.copy')}
              </Button>
              <Show when={props.onSendAgain}>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  ref={sendAgain}
                  disabled={props.sending}
                  onClick={() => confirm(true)}
                >
                  {t('agentSend.sendAgain')}
                </Button>
              </Show>
            </>
          }
        >
          <span class="mr-auto text-xs text-ink-muted">
            {t('agentSend.mayRunTwice')}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={props.sending}
            onClick={() => confirm(false)}
          >
            {t('agentSend.cancel')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            ref={sendAnyway}
            disabled={props.sending}
            onClick={() => props.onSendAgain?.()}
          >
            {t('agentSend.sendAnyway')}
          </Button>
        </Show>
      </Card.Footer>
    </Card>
  );
}
