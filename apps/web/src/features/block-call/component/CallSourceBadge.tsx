import ArrowUpRightIcon from '@icon/system/regular/arrow-up-right.svg';
import type { CallRecordSource } from '@service-storage/generated/schemas/callRecordSource';
import { Badge, badgeTriggerClasses } from '@ui';
import { Show } from 'solid-js';

const PROVIDER_NAMES: Record<CallRecordSource['provider'], string | undefined> =
  {
    macro: undefined,
    granola: 'Granola',
    dialpad: 'Dialpad',
  };

/** Where an imported call came from, linking back to it when it can. */
export function CallSourceBadge(props: { source: CallRecordSource }) {
  const name = () => PROVIDER_NAMES[props.source.provider];
  return (
    <Show when={name()}>
      {(name) => (
        <Show
          when={props.source.externalUrl}
          fallback={
            <Badge variant="outline" size="sm">
              {name()}
            </Badge>
          }
        >
          {(url) => (
            <a
              href={url()}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`Open in ${name()}`}
              class={badgeTriggerClasses({ variant: 'outline', size: 'sm' })}
            >
              {name()}
              <ArrowUpRightIcon class="size-3 opacity-70" />
            </a>
          )}
        </Show>
      )}
    </Show>
  );
}
