import { t } from '@app/lib/i18n';
import CaretDownIcon from '@icon/system/regular/caret-down.svg';
import type { ToolPermissionSourceCandidate } from '@service-agent-harness/generated/schemas';
import { Dropdown, SingleSelectCheck } from '@ui';
import { For, Show } from 'solid-js';
import { policyIdentity } from '../core/references';
import { PolicyAvatar } from './policy-avatar';
import { policyName, scopeLabel, unavailableReason } from './source-labels';

/**
 * Set agent: the policies this agent may follow, each with its picture,
 * name, @handle and whose it is. One that would loop or chain too long is
 * listed but disabled, saying why.
 */
export function PolicySourcePicker(props: {
  candidates: readonly ToolPermissionSourceCandidate[];
  /** The candidate shown as picked. */
  selected?: string;
  disabled?: boolean;
  onPick: (candidate: ToolPermissionSourceCandidate) => void;
}) {
  return (
    <Dropdown placement="bottom-end">
      <Dropdown.Trigger
        variant="secondary"
        size="sm"
        disabled={props.disabled || props.candidates.length === 0}
      >
        {t('agentPermissions.setAgent')}
        <CaretDownIcon
          aria-hidden="true"
          class="size-3 shrink-0 pointer-events-none"
        />
      </Dropdown.Trigger>
      <Dropdown.Content class="min-w-64 max-w-[min(24rem,calc(100vw-2rem))]">
        <Dropdown.Group>
          <For each={props.candidates}>
            {(candidate) => {
              const identity = () => policyIdentity(candidate);
              return (
                <Dropdown.Item
                  textValue={policyName(candidate)}
                  disabledReason={unavailableReason(candidate)}
                  onSelect={() => props.onPick(candidate)}
                >
                  <PolicyAvatar
                    kind={candidate.kind}
                    agent={candidate.agent}
                    size="md"
                  />
                  <span class="flex min-w-0 flex-1 flex-col">
                    <span class="flex min-w-0 items-baseline gap-1.5">
                      <span class="truncate">{policyName(candidate)}</span>
                      <Show when={identity().handle}>
                        {(handle) => (
                          <span class="truncate text-xs text-ink-muted">
                            @{handle()}
                          </span>
                        )}
                      </Show>
                    </span>
                    <span class="truncate text-xs text-ink-extra-muted">
                      {scopeLabel(candidate)}
                    </span>
                  </span>
                  <SingleSelectCheck
                    active={candidate.policyId === props.selected}
                  />
                </Dropdown.Item>
              );
            }}
          </For>
        </Dropdown.Group>
      </Dropdown.Content>
    </Dropdown>
  );
}
