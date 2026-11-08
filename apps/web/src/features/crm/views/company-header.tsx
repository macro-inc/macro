import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { EntityIcon } from '@core/component/EntityIcon';
import { createInlineRename, RenameTitle } from '@ui/components/InlineRename';
import { ResultAsync } from 'neverthrow';
import {
  type CrmCompanyEntity,
  formatDateAndTime,
  formatRelativeTimestamp,
} from '@entity';
import ClockIcon from '@icon/system/regular/clock.svg';
import GlobeIcon from '@icon/system/regular/globe.svg';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { Badge, Tooltip } from '@ui';
import { createEffect, createSignal, For, onMount, Show } from 'solid-js';
import { CompanyVisibilityButton } from './company-visibility-button';
import { useSetCompanyNameMutation } from './use-crm';

function Description(props: { text: string }) {
  const [expanded, setExpanded] = createSignal(false);
  const [hasOverflow, setHasOverflow] = createSignal(false);
  let ref: HTMLParagraphElement | undefined;

  // Measure overflow while clamped; rerun when the text changes, after
  // collapsing back, and when the width changes (the header mounts before
  // its layout settles). Skip while expanded — clientHeight then equals
  // scrollHeight and would flip hasOverflow off incorrectly.
  const measure = () => {
    if (ref && !expanded())
      setHasOverflow(ref.scrollHeight > ref.clientHeight + 1);
  };
  createEffect(() => {
    props.text;
    if (expanded()) return;
    requestAnimationFrame(measure);
  });
  onMount(() => createResizeObserver(() => ref, measure));

  return (
    <div class="flex flex-col items-start gap-0.5">
      <p
        ref={ref}
        class={`text-sm text-ink-muted ${expanded() ? '' : 'line-clamp-3'}`}
      >
        {props.text}
      </p>
      <Show when={hasOverflow()}>
        <button
          type="button"
          onClick={() => setExpanded(!expanded())}
          class="text-xs text-ink-muted underline hover:text-ink"
        >
          {expanded() ? 'Show less' : 'Show more'}
        </button>
      </Show>
    </div>
  );
}

// Renames write the team-scoped `custom_name` override, never the global
// directory.
function TitleEditor(props: { company: CrmCompanyEntity }) {
  const renameMutation = useSetCompanyNameMutation();
  const rename = createInlineRename({
    key: (company: CrmCompanyEntity) => company.id,
    name: (company) => company.name,
    rename: (company, name) =>
      ResultAsync.fromPromise(
        renameMutation.mutateAsync({ companyId: company.id, name }),
        () => 'Could not rename this company. Please try again.'
      ),
    failureMessage: (message: string) => message,
  });
  return (
    <RenameTitle
      rename={rename}
      target={props.company}
      startOn="click"
      aria-label="Company name"
      placeholder="Company"
      class="block w-full text-2xl font-semibold"
    />
  );
}

/**
 * Company overview header laid out like a project: the name, the company's
 * facts as pills beneath it, then its pre-generated description.
 */
export function CompanyHeader(props: { company?: CrmCompanyEntity }) {
  return (
    <div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div class="size-8 shrink-0">
          <EntityIcon targetType="crm_company" size="fill" />
        </div>
        <h1 class="min-w-0 max-w-full mobile:flex-1 text-2xl font-semibold">
          <Show
            when={props.company}
            fallback={<ListSkeleton.Bar class="h-6 w-48" />}
          >
            {(company) => <TitleEditor company={company()} />}
          </Show>
        </h1>
        <Show when={props.company}>
          {(company) => (
            <CompanyVisibilityButton identity companyId={company().id} />
          )}
        </Show>
      </div>
      <Show when={props.company}>
        {(company) => (
          <div
            class="mb-6 mt-3 flex flex-wrap items-center gap-2"
            aria-label="Company details"
          >
            <For each={company().domains}>
              {(domain) => (
                <Badge variant="ghost" size="sm">
                  <GlobeIcon class="size-3" />
                  {domain.domain}
                </Badge>
              )}
            </For>
            {/* `updatedAt` carries `crm_companies.last_interaction`, which
                the backend keeps fresh from synced workspace emails. */}
            <Show when={company().updatedAt}>
              {(lastInteraction) => (
                <Tooltip label={formatDateAndTime(lastInteraction())}>
                  <Badge variant="ghost" size="sm">
                    <ClockIcon class="size-3" />
                    Last interacted {formatRelativeTimestamp(lastInteraction())}
                  </Badge>
                </Tooltip>
              )}
            </Show>
          </div>
        )}
      </Show>
      <Show when={props.company?.description}>
        {(description) => <Description text={description()} />}
      </Show>
    </div>
  );
}
