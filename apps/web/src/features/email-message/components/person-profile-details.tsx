import { openExternalUrl } from '@core/util/url';
import ExternalIcon from '@icon/system/regular/arrow-square-out.svg';
import { Show } from 'solid-js';
import {
  type PersonProfile,
  personProfileSummary,
} from '../core/person-profile';

export function PersonProfileDetails(props: { profile: PersonProfile }) {
  const summary = () => personProfileSummary(props.profile);
  return (
    <Show when={summary() || props.profile.linkedinUrl}>
      <div class="flex max-w-80 flex-col gap-1 px-2 pb-2">
        <Show when={summary()}>
          {(text) => (
            <p class="line-clamp-2 text-xs text-ink-muted">{text()}</p>
          )}
        </Show>
        <Show when={props.profile.linkedinUrl}>
          {(url) => (
            <a
              href={url()}
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex w-fit items-center gap-1 rounded text-xs font-medium text-ink hover:underline focus-visible:outline-2"
              onClick={(event) => {
                event.preventDefault();
                openExternalUrl(url());
              }}
            >
              LinkedIn
              <ExternalIcon class="size-3" aria-hidden="true" />
            </a>
          )}
        </Show>
      </div>
    </Show>
  );
}
