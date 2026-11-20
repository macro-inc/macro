import { t } from '@app/lib/i18n';
import {
  StaticMarkdown,
  StaticMarkdownContext,
} from '@core/component/LexicalMarkdown/component/core/StaticMarkdown';
import { aiChatTheme } from '@core/component/LexicalMarkdown/theme';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import type { CallRecord } from '@service-call/client';
import { Spinner, Tooltip } from '@ui';
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
      <section class="flex flex-col gap-2">
        <Show when={!props.hideHeading}>
          <h3 class="flex min-h-7 items-center text-base font-semibold text-ink">
            <Tooltip
              as="span"
              label={t('calls.detailAttribution')}
              class="gap-2"
              tabIndex={0}
            >
              <SparkleIcon class="size-4 shrink-0" />
              {t('calls.detailSummary')}
            </Tooltip>
          </h3>
        </Show>
        <Show
          when={summary()}
          fallback={
            <div class="flex items-center gap-2">
              <Spinner />
              <span class="text-sm text-ink-subtle">
                {t('calls.detailGeneratingSummary')}
              </span>
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
