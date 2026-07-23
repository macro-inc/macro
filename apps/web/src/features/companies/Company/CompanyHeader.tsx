import { EntityIcon } from '@core/component/EntityIcon';
import { InlineTitleEditor } from '@core/component/InlineTitleEditor';
import type { CrmCompanyEntity } from '@entity';
import { useSetCompanyNameMutation } from '@queries/crm/companies';
import { createEffect, createSignal, Show } from 'solid-js';

function Description(props: { text: string }) {
  const [expanded, setExpanded] = createSignal(false);
  const [hasOverflow, setHasOverflow] = createSignal(false);
  let ref: HTMLParagraphElement | undefined;

  // Measure overflow while clamped; rerun when the text changes or after
  // collapsing back. Skip while expanded — clientHeight then equals
  // scrollHeight and would flip hasOverflow off incorrectly.
  createEffect(() => {
    props.text;
    if (expanded()) return;
    requestAnimationFrame(() => {
      if (ref) setHasOverflow(ref.scrollHeight > ref.clientHeight + 1);
    });
  });

  return (
    <div class="flex flex-col items-start gap-0.5">
      <p
        ref={ref}
        class={`text-sm text-ink-muted ${expanded() ? '' : 'line-clamp-2'}`}
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
  return (
    <InlineTitleEditor
      value={props.company.name}
      placeholder="Company"
      ariaLabel="Company name"
      onRename={(name) =>
        renameMutation.mutate({ companyId: props.company.id, name })
      }
    />
  );
}

export function CompanyHeader(props: { company?: CrmCompanyEntity }) {
  return (
    <div class="flex items-start gap-3">
      <div class="size-10 shrink-0">
        <EntityIcon targetType="crm_company" size="fill" />
      </div>
      <div class="flex min-w-0 flex-col gap-1">
        <h1 class="min-w-0 text-xl font-semibold">
          <Show when={props.company} fallback={'Loading company…'}>
            {(company) => <TitleEditor company={company()} />}
          </Show>
        </h1>
        <Show when={props.company?.description}>
          {(description) => <Description text={description()} />}
        </Show>
      </div>
    </div>
  );
}
