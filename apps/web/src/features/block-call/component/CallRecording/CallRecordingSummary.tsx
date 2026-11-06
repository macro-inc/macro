import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import type { CallRecord } from '@service-call/client';
import { Spinner } from '@ui';
import { createMemo, Show } from 'solid-js';

export function CallRecordingSummarySection(props: {
  record: CallRecord;
  hideHeading?: boolean;
}) {
  const summary = createMemo(() => {
    const value = props.record.summary;
    if (!value) return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  });

  const isPending = createMemo(
    () =>
      !summary() && !props.record.isActive && props.record.transcript.length > 0
  );

  const shouldShow = createMemo(() => summary() || isPending());

  return (
    <Show when={shouldShow()}>
      <section class="flex flex-col gap-5">
        <Show when={!props.hideHeading}>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <h3 class="text-base font-semibold text-ink">Summary</h3>
            <Show when={summary()}>
              <span class="flex items-center gap-1 text-xs text-ink-muted">
                <SparkleIcon class="size-3.5" />
                Written by Macro after the call
              </span>
            </Show>
          </div>
        </Show>
        <Show
          when={summary()}
          fallback={
            <div class="flex items-center gap-2">
              <Spinner />
              <span class="text-sm text-ink-subtle">Generating summary…</span>
            </div>
          }
        >
          {(text) => (
            <div class="text-sm/6 text-ink-muted text-pretty">
              <StaticMarkdownContext theme={aiChatTheme}>
                <StaticMarkdown markdown={text()} />
              </StaticMarkdownContext>
            </div>
          )}
        </Show>
      </section>
    </Show>
  );
}
