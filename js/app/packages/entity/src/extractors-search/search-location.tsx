import { Show } from 'solid-js';
import { match } from 'ts-pattern';
import type { ContentHitData } from '../types/search';

interface SearchLocationProps {
  hit?: ContentHitData;
}

/**
 * Gets location description for a content hit
 */
function getLocationDescription(hit: ContentHitData): string | undefined {
  return match(hit)
    .with({ type: 'pdf' }, (h) => `Page ${h.location.searchPage}`)
    .otherwise(() => undefined);
}

/**
 * Displays the location information for a search hit
 */
export function SearchLocation(props: SearchLocationProps) {
  const locationText = () =>
    props.hit ? getLocationDescription(props.hit) : undefined;

  return (
    <Show when={locationText()}>
      {(text) => <span class="text-ink-muted text-xs">{text()}</span>}
    </Show>
  );
}
