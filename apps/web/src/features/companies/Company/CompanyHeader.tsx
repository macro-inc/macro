import { EntityIcon } from '@core/component/EntityIcon';
import type { CrmCompanyEntity } from '@entity';
import PencilIcon from '@phosphor/pencil-simple.svg';
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

// Inline-editable company name, mirroring the markdown-document title UX:
// the title is always editable in place — click to put the caret in it,
// type, and the rename saves on blur/Enter (Escape discards). Saves write
// the team-scoped `custom_name` override; blank edits are dropped rather
// than saved.
function TitleEditor(props: { company: CrmCompanyEntity }) {
  const renameMutation = useSetCompanyNameMutation();
  // Local draft while the user is typing; null = show the cached name.
  const [draft, setDraft] = createSignal<string | null>(null);
  let inputRef: HTMLInputElement | undefined;

  const commit = () => {
    const raw = draft();
    setDraft(null);
    if (raw == null) return;
    const next = raw.trim();
    if (!next || next === props.company.name) return;
    renameMutation.mutate({ companyId: props.company.id, name: next });
  };

  return (
    <div class="group flex min-w-0 items-center gap-1.5">
      <input
        ref={inputRef}
        type="text"
        aria-label="Company name"
        autocomplete="off"
        data-1p-ignore
        class="field-sizing-content min-w-0 max-w-full truncate bg-transparent text-xl font-semibold outline-none"
        placeholder="Company"
        value={draft() ?? props.company.name}
        onInput={(e) => setDraft(e.currentTarget.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
      {/* Hover-only affordance; the input itself is the tab stop, and the
          pencil hides while editing (group-focus-within). */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        class="shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-0"
        onClick={() => {
          inputRef?.focus();
          inputRef?.select();
        }}
      >
        <PencilIcon class="size-4" />
      </button>
    </div>
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
