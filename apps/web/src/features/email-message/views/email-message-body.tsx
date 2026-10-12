import { StaticMarkdown } from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { channelTheme } from '@core/component/LexicalMarkdown/theme';
import DotsThree from '@phosphor/dots-three.svg';
import { Button, cn } from '@ui';
import { Match, onCleanup, Show, Switch, untrack } from 'solid-js';

import { useEmailRenderingContext } from '../context/email-rendering-context';
import {
  createEmailMessageBody,
  type EmailMessageBodyProps,
} from '../primitives/email-message-body';
import { createStableEmailMessageBody } from '../primitives/stable-email-message-body';

/**
 * Chooses once per body: a rollout change applies to bodies opened afterwards,
 * so a displayed body is never rebuilt by a flag update.
 */
export function EmailMessageBody(props: EmailMessageBodyProps) {
  const context = useEmailRenderingContext();
  // A thread open waits for bodies that show HTML now; Markdown and text
  // bodies mount no HTML host and never report.
  const showsHtml = untrack(
    () =>
      !!props.message.body_html_sanitized &&
      !props.message.body_macro &&
      context.canRender?.() !== false
  );
  if (showsHtml) {
    const release = context.trackBodyOpen?.(untrack(() => props.message.db_id));
    if (release) onCleanup(release);
  }
  return untrack(() => context.cachedBodies?.() === true) ? (
    <CachedEmailMessageBody {...props} />
  ) : (
    <DirectEmailMessageBody {...props} />
  );
}

/** Main's body: prepared on mount, rebuilt when its rendering inputs change. */
function DirectEmailMessageBody(props: EmailMessageBodyProps) {
  const { showFullHTML, setShowFullHTML, host, hasHiddenReplyStructure } =
    createEmailMessageBody(props, useEmailRenderingContext());
  return (
    <div
      class="ph-no-capture flex flex-col [&_.md-p:first-child]:mt-0 [&_.md-p:last-child]:mb-0"
      onPointerDown={() => {
        if (!props.isBodyExpanded() && props.message.db_id) {
          props.setExpandedMessageBody(props.message.db_id);
          props.setFocusedMessageId(props.message.db_id);
        } else if (props.message.db_id) {
          props.setFocusedMessageId(props.message.db_id);
        }
      }}
    >
      <div
        class="relative min-w-0 w-full"
        classList={{
          isPersonal: props.isPersonal,
          'line-clamp-3': !props.isBodyExpanded(),
        }}
      >
        <Switch>
          {/* If available, we use body_macro to render "Macro-fied" email content in static markdown with, e.g. correctly styled document mentions. */}
          <Match when={!showFullHTML() && props.message.body_macro}>
            {(bodyMacro) => {
              return (
                <StaticMarkdown
                  markdown={bodyMacro()}
                  theme={channelTheme}
                  target="internal"
                />
              );
            }}
          </Match>
          <Match when={!props.message.body_html_sanitized}>
            <StaticMarkdown
              markdown={props.message.body_text ?? ''}
              theme={channelTheme}
              target="internal"
            />
          </Match>
          <Match when={true}>{host()}</Match>
        </Switch>
        <Show when={!showFullHTML() && hasHiddenReplyStructure()}>
          <div class="flex items-center mt-1.5 mb-2">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => setShowFullHTML(true)}
              class={cn(
                'text-ink-extra-muted hover:text-ink-muted',
                props.isFocused ? 'hover:bg-surface' : 'hover:bg-active'
              )}
            >
              <DotsThree />
            </Button>
          </div>
        </Show>
      </div>
    </div>
  );
}

/** The prepared-body cache path (`enable-email-render-cache`). */
function CachedEmailMessageBody(props: EmailMessageBodyProps) {
  const context = useEmailRenderingContext();
  const {
    showFullHTML,
    setShowFullHTML,
    host,
    hasHiddenReplyStructure,
    isPending,
    isError,
    retry,
  } = createStableEmailMessageBody(props, context);
  return (
    <Show when={context.canRender?.() !== false}>
      <div
        class="ph-no-capture flex flex-col [&_.md-p:first-child]:mt-0 [&_.md-p:last-child]:mb-0"
        onPointerDown={() => {
          if (!props.isBodyExpanded() && props.message.db_id) {
            props.setExpandedMessageBody(props.message.db_id);
            props.setFocusedMessageId(props.message.db_id);
          } else if (props.message.db_id) {
            props.setFocusedMessageId(props.message.db_id);
          }
        }}
      >
        <div
          class="relative min-w-0 w-full"
          classList={{
            isPersonal: props.isPersonal,
            'line-clamp-3': !props.isBodyExpanded(),
          }}
        >
          <Switch>
            {/* If available, we use body_macro to render "Macro-fied" email content in static markdown with, e.g. correctly styled document mentions. */}
            <Match when={!showFullHTML() && props.message.body_macro}>
              {(bodyMacro) => {
                return (
                  <StaticMarkdown
                    markdown={bodyMacro()}
                    theme={channelTheme}
                    target="internal"
                  />
                );
              }}
            </Match>
            <Match when={!props.message.body_html_sanitized}>
              <StaticMarkdown
                markdown={props.message.body_text ?? ''}
                theme={channelTheme}
                target="internal"
              />
            </Match>
            <Match when={true}>
              <Show
                when={host()}
                fallback={
                  <div
                    class="min-h-12 text-ink-muted"
                    aria-live="polite"
                    aria-busy={isPending()}
                  >
                    <Show when={isError()} fallback="Loading message…">
                      <Button variant="ghost" onClick={retry}>
                        Retry loading message
                      </Button>
                    </Show>
                  </div>
                }
              >
                {host()}
              </Show>
            </Match>
          </Switch>
          <Show when={!showFullHTML() && hasHiddenReplyStructure()}>
            <div class="flex items-center mt-1.5 mb-2">
              <Button
                variant="ghost"
                size="icon-sm"
                disabled={isPending()}
                onClick={() => setShowFullHTML(true)}
                class={cn(
                  'text-ink-extra-muted hover:text-ink-muted',
                  props.isFocused ? 'hover:bg-surface' : 'hover:bg-active'
                )}
              >
                <DotsThree />
              </Button>
            </div>
          </Show>
        </div>
      </div>
    </Show>
  );
}
