import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import TagSimpleIcon from '@icon/system/regular/tag-simple.svg';
import { useEmailUserLabelsQuery } from '@queries/email/labels';
import { useMailAccountsQuery } from '@queries/email/mail-accounts';
import {
  formatLabelPath,
  type NestedLabel,
  nestLabels,
} from '@queries/email/nested-labels';
import { queryReadyGate } from '@queries/gate';
import { type ApiLabel, ApiLabelType } from '@service-email/generated/schemas';
import { Button, Checkbox, cn, Input } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';

type LabelGroup = {
  account: string;
  labels: NestedLabel<ApiLabel>[];
};

/**
 * The labels of every inbox the viewer owns or manages, as each inbox's tree
 * under its address. Never suspends.
 */
function createLabelGroups() {
  const labels = useEmailUserLabelsQuery(() => true);
  const accounts = useMailAccountsQuery();
  const groups = createMemo((): LabelGroup[] => {
    const all = queryReadyGate(labels)
      ? labels.data.labels.filter((label) => label.type === ApiLabelType.User)
      : [];
    return (accounts.data?.links ?? [])
      .map((link) => ({
        account: link.email_address,
        labels: nestLabels(
          all.filter((label) => label.linkId === link.id),
          link.provider
        ),
      }))
      .filter((group) => group.labels.length > 0);
  });
  const names = createMemo(
    () =>
      new Map(
        groups().flatMap((group) =>
          group.labels.map(
            (item) => [item.label.id, formatLabelPath(item.path)] as const
          )
        )
      )
  );
  return {
    groups,
    name: (id: string) => names().get(id),
    loading: () => labels.isPending || accounts.isPending,
    failed: () => labels.isError || accounts.isError,
  };
}

/** Which labels a thread must gain one of; none chosen is any label. */
export function RoutineEmailLabels(props: {
  labels: string[];
  onChange: (labels: string[]) => void;
}) {
  const groups = createLabelGroups();
  const [choosing, setChoosing] = createSignal(false);
  const [search, setSearch] = createSignal('');
  const chosen = (id: string) => props.labels.includes(id);
  const toggle = (id: string) =>
    props.onChange(
      chosen(id)
        ? props.labels.filter((label) => label !== id)
        : [...props.labels, id]
    );
  const shown = () => {
    const text = search().trim().toLowerCase();
    return groups
      .groups()
      .map((group) => ({
        ...group,
        // The provider's own name ("Finance/Invoices") or the one shown.
        labels: group.labels.filter((item) =>
          [item.label.name, formatLabelPath(item.path)].some((name) =>
            name.toLowerCase().includes(text)
          )
        ),
      }))
      .filter((group) => group.labels.length > 0);
  };
  const severalAccounts = () => groups.groups().length > 1;
  return (
    <div class="mb-3 grid gap-1.5">
      <span class="text-xs font-medium">Labels</span>
      <div class="flex flex-wrap gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          aria-pressed={props.labels.length === 0}
          onClick={() => props.onChange([])}
        >
          Any label
        </Button>
        <For each={props.labels}>
          {(id) => (
            <Button
              variant="secondary"
              size="sm"
              aria-pressed={true}
              aria-label={`Remove ${groups.name(id) ?? 'unknown label'}`}
              onClick={() => toggle(id)}
            >
              <TagSimpleIcon class="size-3.5" />
              {groups.name(id) ?? 'Unknown label'}
            </Button>
          )}
        </For>
        <Button
          variant="secondary"
          size="sm"
          aria-expanded={choosing()}
          onClick={() => setChoosing(!choosing())}
        >
          Choose labels
          <CaretDownIcon
            class={cn(
              'size-3 transition-transform',
              choosing() && 'rotate-180'
            )}
          />
        </Button>
      </div>
      <Show when={choosing()}>
        <div class="grid gap-1 rounded-lg border border-edge-muted p-1.5">
          <Input
            size="sm"
            aria-label="Search labels"
            placeholder="Search labels"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
          />
          <div class="max-h-52 overflow-y-auto">
            <Show
              when={!groups.loading()}
              fallback={<p class="p-2 text-xs text-ink-muted">Loading…</p>}
            >
              <Show when={groups.failed()}>
                <p class="p-2 text-xs text-failure">
                  Your labels couldn’t be loaded.
                </p>
              </Show>
              <Show
                when={shown().length}
                fallback={
                  <p class="p-2 text-xs text-ink-muted">
                    {search().trim()
                      ? 'No label matches.'
                      : 'Your inboxes have no labels yet.'}
                  </p>
                }
              >
                <For each={shown()}>
                  {(group) => (
                    <div class="grid">
                      <Show when={severalAccounts()}>
                        <p class="truncate px-2 pb-0.5 pt-2 text-xs font-medium text-ink-muted">
                          {group.account}
                        </p>
                      </Show>
                      <For each={group.labels}>
                        {(item) => (
                          <Checkbox
                            size="sm"
                            class="flex rounded-md py-1 pr-2 text-xs not-touch:hover:bg-hover touch:min-h-11"
                            style={{
                              'padding-left': `${0.5 + (item.path.length - 1)}rem`,
                            }}
                            checked={chosen(item.label.id)}
                            onChange={() => toggle(item.label.id)}
                          >
                            <Checkbox.Control />
                            <Checkbox.Label class="flex min-w-0 items-center gap-2">
                              <TagSimpleIcon class="size-3.5 shrink-0 text-ink-muted" />
                              <span class="truncate">
                                {search().trim()
                                  ? formatLabelPath(item.path)
                                  : item.leaf}
                              </span>
                            </Checkbox.Label>
                          </Checkbox>
                        )}
                      </For>
                    </div>
                  )}
                </For>
              </Show>
            </Show>
          </div>
        </div>
      </Show>
    </div>
  );
}

/** The chosen labels on a trigger's chip, such as "Finance / Invoices". */
export function RoutineEmailLabelsLabel(props: { labels: string[] }) {
  const groups = createLabelGroups();
  const label = () => {
    if (!props.labels.length) return 'Any label';
    if (props.labels.length > 2) return `${props.labels.length} labels`;
    const names = props.labels.map(groups.name);
    return names.every(Boolean)
      ? names.join(' or ')
      : `${props.labels.length} ${props.labels.length === 1 ? 'label' : 'labels'}`;
  };
  return <span title={label()}>{label()}</span>;
}
