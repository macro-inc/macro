import { OwnerLabel } from '@entity/owner/owner-display';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { AccessLevelSelect } from '../components/AccessLevelSelect';
import type { SharingSource } from '../context/contracts';
import type { AccessLevel } from '../core/types';

export function DirectAccessView(props: {
  source: SharingSource;
  exclude?: readonly string[];
}) {
  const change = async (user: string, level: AccessLevel | null) => {
    try {
      await props.source.setGrant(user, level);
    } catch {
      /* Source reports the failed write. */
    }
  };
  return (
    <For
      each={props.source
        .grants()
        .filter((grant) => !props.exclude?.includes(grant.userId))}
    >
      {(grant) => (
        <div class="flex flex-wrap items-center justify-between gap-2">
          <OwnerLabel ownerId={grant.userId} />
          <div class="flex items-center gap-2">
            <AccessLevelSelect
              label="Person's access level"
              value={grant.accessLevel}
              levels={[
                'view',
                ...(props.source.state()?.supportedLevels ?? []).filter(
                  (level) => level !== 'view'
                ),
              ]}
              disabled={!props.source.state()?.canReview || props.source.busy()}
              onChange={(level) => void change(grant.userId, level)}
            />
            <Show when={props.source.state()?.canReview}>
              <Button
                variant="ghost"
                size="sm"
                disabled={props.source.busy()}
                onClick={() => void change(grant.userId, null)}
              >
                Remove access
              </Button>
            </Show>
          </div>
        </div>
      )}
    </For>
  );
}
