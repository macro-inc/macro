import { t } from '@app/lib/i18n';
import type { GatedOperation } from '@service-agent-harness/generated/schemas';
import { createSignal, For, Show } from 'solid-js';
import {
  type GatedGroup,
  groupGatedOperations,
} from '../core/gated-operations';
import { gatedActionName } from './gated-phrases';
import { groupIcon } from './group-icon';
import { PermissionStateGlyph } from './permission-state-glyph';

/** Rows shown before "Show N more". */
const DEFAULT_MAX = 6;

/**
 * The operations a permission held or refused, by group: each row is the
 * state's glyph, the action, the tool's name and, on a wide card, its
 * `service.operation`.
 */
export function GatedOperationList(props: {
  operations: readonly GatedOperation[];
  max?: number;
}) {
  const [expanded, setExpanded] = createSignal(false);
  const max = () => props.max ?? DEFAULT_MAX;
  const groups = () => groupGatedOperations(props.operations);
  const total = () => props.operations.length;
  const hidden = () => (expanded() ? 0 : Math.max(0, total() - max()));

  // The first `max` rows in display order, cut across groups.
  const shown = (): GatedGroup[] => {
    if (expanded()) return groups();
    let left = max();
    const result: GatedGroup[] = [];
    for (const group of groups()) {
      if (left <= 0) break;
      const operations = group.operations.slice(0, left);
      left -= operations.length;
      result.push({ ...group, operations });
    }
    return result;
  };

  return (
    <div class="@container/gated mt-3 overflow-hidden rounded-lg border border-edge-muted">
      <ul
        aria-label={t('agentPermissionsChat.operationsLabel')}
        class="divide-y divide-edge-muted"
      >
        <For each={shown()}>
          {(group) => {
            const Icon = groupIcon(group.group);
            return (
              <li class="pb-1.5">
                <div class="flex items-center gap-2 px-3 pt-2.5 pb-1 text-xs font-medium text-ink-muted">
                  <Icon aria-hidden="true" class="size-3.5 shrink-0" />
                  {group.groupName}
                </div>
                <ul>
                  <For each={group.operations}>
                    {(operation) => (
                      <li class="flex min-w-0 items-center gap-2 px-3 py-1 text-sm">
                        <PermissionStateGlyph state={operation.state} />
                        <span class="w-14 shrink-0 text-ink-muted">
                          {gatedActionName(operation.action)}
                        </span>
                        <span class="min-w-0 flex-1 truncate text-ink">
                          {operation.label}
                        </span>
                        <span
                          aria-hidden="true"
                          class="hidden min-w-0 shrink truncate font-mono text-xs text-ink-extra-muted @min-[420px]/gated:inline"
                        >
                          {operation.service}.{operation.operation}
                        </span>
                      </li>
                    )}
                  </For>
                </ul>
              </li>
            );
          }}
        </For>
      </ul>
      <Show when={total() > max()}>
        <button
          type="button"
          aria-expanded={expanded()}
          class="w-full border-t border-edge-muted px-3 py-2 text-left text-xs text-ink-muted outline-none not-touch:hover:text-ink focus-visible:bg-ink/4 touch:min-h-[44px]"
          onClick={() => setExpanded((open) => !open)}
        >
          <Show
            when={hidden() > 0}
            fallback={t('agentPermissionsChat.showFewerOperations')}
          >
            {t('agentPermissionsChat.showMoreOperations', { count: hidden() })}
          </Show>
        </button>
      </Show>
    </div>
  );
}
