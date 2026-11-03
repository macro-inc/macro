import { FocusImportance } from '@app/features/home/components/focus-importance';
import { t } from '@app/lib/i18n';
import ArrowIcon from '@icon/system/regular/arrow-right.svg';
import ChatIcon from '@icon/system/regular/chat-circle.svg';
import TaskIcon from '@icon/system/regular/check-square.svg';
import ClockIcon from '@icon/system/regular/clock.svg';
import DatabaseIcon from '@icon/system/regular/database.svg';
import EmailIcon from '@icon/system/regular/envelope.svg';
import DocumentIcon from '@icon/system/regular/file-text.svg';
import SparkleIcon from '@icon/system/regular/sparkle.svg';
import CloseIcon from '@icon/system/regular/x.svg';
import { Button, badgeTriggerClasses, Tooltip } from '@ui';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { type FeedItem, feedSourceLabel } from '../core/feed';

const ACTION_ICONS = {
  create_agent: SparkleIcon,
  create_database: DatabaseIcon,
  create_routine: ClockIcon,
  ask_agent: DocumentIcon,
};
export function FeedItemRow(props: {
  item: FeedItem;
  opening: boolean;
  disabled: boolean;
  onStart: () => void;
  onOpenSource: () => void;
  onDismiss: () => void;
}) {
  const icon = () => {
    if (props.item.kind === 'idea') return ACTION_ICONS[props.item.action];
    switch (props.item.sourceEntity?.type) {
      case 'email':
        return EmailIcon;
      case 'channel':
        return ChatIcon;
      case 'task':
        return TaskIcon;
      default:
        return ACTION_ICONS[props.item.action];
    }
  };
  const sourceLabel = () =>
    feedSourceLabel(props.item.source) || t('forYou.source');
  return (
    <li
      class="group flex gap-5 border-b border-edge-muted py-7 last:border-b-0"
      data-feed-item={props.item.id}
    >
      <div
        class="pt-6 text-ink-muted"
        classList={{ 'text-accent': props.item.kind === 'idea' }}
      >
        <Dynamic component={icon()} class="size-6" />
      </div>
      <article class="min-w-0 flex-1">
        <div class="mb-2 flex items-center gap-2 text-xs text-ink-extra-muted">
          <span
            class="font-medium"
            classList={{ 'text-accent': props.item.kind === 'idea' }}
          >
            {t(`forYou.${props.item.kind}`)}
          </span>
          <span class="ml-auto shrink-0">{props.item.time}</span>
        </div>
        <h2 class="text-lg font-medium leading-snug text-ink">
          {props.item.title}
        </h2>
        <p class="mt-2 text-sm leading-relaxed text-ink-muted">
          {props.item.summary}
        </p>
        <div class="mt-4 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={props.disabled}
            loading={props.opening}
            onClick={props.onStart}
          >
            {t(`forYou.${props.item.action}`)}
            <ArrowIcon class="size-3.5" />
          </Button>
          <Show when={props.item.kind === 'task'}>
            <FocusImportance
              importance={props.item.importance}
              label={t('forYou.importance', { score: props.item.importance })}
            />
          </Show>
          <Show when={props.item.sourceEntity}>
            <Tooltip as="span" label={sourceLabel()} class="min-w-0 max-w-56">
              <button
                type="button"
                class={badgeTriggerClasses({
                  variant: 'secondary',
                  size: 'sm',
                  class: 'min-w-0 max-w-56 gap-1 px-2',
                })}
                aria-label={t('forYou.openSource', { source: sourceLabel() })}
                onClick={props.onOpenSource}
                data-feed-source
              >
                <span aria-hidden="true" class="shrink-0">
                  @
                </span>
                <span class="min-w-0 truncate">{sourceLabel()}</span>
              </button>
            </Tooltip>
          </Show>
          <Button
            class="ml-auto"
            variant="ghost"
            size="icon-sm"
            aria-label={t('forYou.dismiss')}
            tooltip={t('forYou.dismiss')}
            onClick={props.onDismiss}
          >
            <CloseIcon class="size-4" />
          </Button>
        </div>
      </article>
    </li>
  );
}
