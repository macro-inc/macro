import ArrowLeft from '@phosphor/arrow-left.svg';
import CaretRight from '@phosphor/caret-right.svg';
import Envelope from '@phosphor/envelope.svg';
import Link from '@phosphor/link.svg';
import Users from '@phosphor/users-three.svg';
import { Button } from '@ui';
import { createSignal, Show } from 'solid-js';
import { homepagePeople } from '../../../core/homepage-demo-people';
import type { DemoEmail } from '../email-fixtures';
import { MessageCard } from './MessageCard';

// Presentation extracted from EmailDetailView, email-message-top-bar,
// EmailMessageView, and bottom-reply-buttons. MessageCard is copied verbatim.
export function EmailThread(props: {
  email: DemoEmail;
  onBack?: () => void;
  onShare?: () => void;
  sharing?: boolean;
}) {
  const [details, setDetails] = createSignal(false);
  return (
    <div class="mail-thread">
      <div class="flex h-12 min-w-0 shrink-0 items-center gap-1 px-2 py-3">
        <Show when={props.onBack}>
          <Button
            variant="plain"
            size="icon-sm"
            aria-label="Back to inbox"
            onClick={props.onBack}
          >
            <ArrowLeft />
          </Button>
        </Show>
        <Envelope class="size-4 shrink-0 text-ink-muted" />
        <span class="truncate text-sm font-medium">{props.email.subject}</span>
        <div class="ml-auto flex items-center gap-1">
          <Button
            variant="plain"
            size="md"
            class="rounded-xl"
            onClick={props.onShare}
            aria-label="Share email"
            data-demo-share-trigger=""
            data-active={props.sharing}
          >
            <Users />
            Share
          </Button>
          <Link class="size-3.5 mx-2 text-ink-muted" aria-hidden="true" />
        </div>
      </div>
      <div class="mail-thread-body">
        <h3 class="block w-full max-w-full min-w-0 text-pretty font-semibold tracking-tight text-ink leading-snug text-2xl mb-6">
          {props.email.subject}
        </h3>
        <MessageCard
          messageId={props.email.id}
          isSelected={false}
          allowHover={false}
          isTouch={false}
        >
          <div class="flex flex-col min-w-0 gap-2 overflow-hidden">
            <div class="flex items-center min-h-6 gap-2">
              <div class="shrink-0 flex justify-center items-center size-6 rounded-full bg-active text-[10px] text-ink-muted">
                {props.email.sender.slice(0, 1)}
              </div>
              <div class="flex flex-row w-full min-w-0 flex-1 items-center gap-2 text-sm">
                <div class="flex flex-row items-center gap-1.5 min-w-0 flex-1">
                  <span class="text-ink font-medium truncate">
                    {props.email.sender}
                  </span>
                  <span class="text-ink-extra-muted/60 shrink-0">to me</span>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Message details"
                    aria-expanded={details()}
                    onClick={() => setDetails(!details())}
                  >
                    <CaretRight
                      class={details() ? 'size-3 rotate-90' : 'size-3'}
                    />
                  </Button>
                </div>
                <span class="text-ink-extra-muted/60 tabular-nums shrink-0 text-xs">
                  {props.email.time}
                </span>
              </div>
            </div>
            <Show when={details()}>
              <div class="py-3 border-y border-ink-muted/8 text-xs text-ink-muted">
                From: {props.email.sender} &lt;dana@example.com&gt;
                <br />
                To: Jacob Beckerman &lt;jacob@macro.com&gt;
              </div>
            </Show>
            <div class="mail-message-text text-base text-ink pr-4">
              <p>Hi Jacob,</p>
              <p>
                {props.email.snippet}{' '}
                <Show when={props.email.id === 'dana'}>
                  I’d like to invite the rest of our team.
                </Show>
              </p>
              <p>
                Thanks,
                <br />
                {props.email.sender.split(' ')[0]}
              </p>
            </div>
          </div>
          <div class="relative -mx-4 mb-0 border-t border-ink/20 mt-4">
            <div class="px-4">
              <div class="flex w-full items-center pt-4 gap-2 text-sm text-ink-placeholder">
                <img
                  src={homepagePeople.jacob.photo}
                  class="size-6 rounded-full"
                  alt=""
                />
                <span>Reply...</span>
              </div>
            </div>
          </div>
        </MessageCard>
      </div>
    </div>
  );
}
