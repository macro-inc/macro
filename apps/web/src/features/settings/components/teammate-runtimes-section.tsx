import { shareEntity } from '@app/features/access-requests/core/types';
import { createSharingSource } from '@app/features/access-requests/queries/source';
import { RuntimeAccessAction } from '@app/features/runtime-sharing/components/RuntimeAccessAction';
import { t } from '@app/lib/i18n';
import { useUserId } from '@core/context/user';
import { OwnerLabel } from '@entity/owner/owner-display';
import { useHarnessDirectoryQuery } from '@queries/harnesses/harnesses';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { For, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { ConnectAction } from '../integration-ui';
import { SettingsCard } from '../primitives';
import { RuntimeName } from './connected-runtimes-section';
import { RuntimeOptions } from './runtime-options';

/** A Macro computer belongs to its team and is listed under Macro computers. */
function ownerId(harness: RegisteredHarness): string | undefined {
  if (harness.computer_id) return undefined;
  return harness.owner.type === 'user' ? harness.owner.user_id : undefined;
}

/** Teammates' runtimes, grouped by owner, with the viewer's access to each. */
export function TeammateRuntimesSection(props: {
  /** A team's owner can also take a team machine out of service. */
  canRemoveShared: boolean;
  onRemove: (harness: RegisteredHarness) => void;
}) {
  const userId = useUserId();
  const directory = useHarnessDirectoryQuery();
  const theirs = () =>
    directory.isSuccess
      ? directory.data.filter((harness) => {
          const owner = ownerId(harness);
          return owner !== undefined && owner !== userId();
        })
      : [];
  const owners = () => [
    ...new Set(theirs().flatMap((harness) => ownerId(harness) ?? [])),
  ];
  return (
    <Show when={theirs().length > 0}>
      <div data-teammate-runtimes>
        <h2 class="mb-1 px-6 text-sm font-semibold text-ink">
          {t('runtimeSharing.teammatesRuntimes')}
        </h2>
        <p class="mb-3 px-6 text-xs text-ink-extra-muted">
          {t('runtimeSharing.teammatesRuntimesHint')}
        </p>
        <SettingsCard inset="wide">
          <For each={owners()}>
            {(owner) => (
              <div class="flex flex-col" data-teammate-runtime-owner>
                <div class="flex items-center gap-2 px-6 pt-4 text-sm font-medium text-ink">
                  <OwnerLabel
                    ownerId={owner}
                    suppressClick
                    showTooltip={false}
                  />
                </div>
                <For
                  each={theirs().filter(
                    (harness) => ownerId(harness) === owner
                  )}
                >
                  {(harness) => (
                    <TeammateRuntimeRow
                      harness={harness}
                      canRemove={
                        props.canRemoveShared &&
                        harness.shared_team_ids.length > 0
                      }
                      onRemove={() => props.onRemove(harness)}
                    />
                  )}
                </For>
              </div>
            )}
          </For>
        </SettingsCard>
      </div>
    </Show>
  );
}

/** Same pattern as the viewer's own rows: dot and name, a meta line, actions. */
function TeammateRuntimeRow(props: {
  harness: RegisteredHarness;
  canRemove: boolean;
  onRemove: () => void;
}) {
  const canAsk = () =>
    props.harness.access === 'none' || props.harness.access === 'read';
  const source = createSharingSource(
    () => shareEntity('harness', props.harness.id),
    canAsk
  );
  const requested = () => source.state()?.mine?.status === 'pending';
  const accessLabel = () => {
    if (requested()) return t('runtimeSharing.requested');
    return match(props.harness.access)
      .with('owner', 'user', () => t('runtimeSharing.roleUser'))
      .with('read', () => t('runtimeSharing.roleRead'))
      .with('none', () => t('runtimeSharing.accessNone'))
      .exhaustive();
  };
  return (
    <div
      class="flex items-start justify-between gap-4 py-4 pr-6 pl-14 transition-colors @max-[480px]:flex-col @max-[480px]:gap-2 @max-[480px]:pl-6 [&.ring-2]:bg-accent-bg/50 [&.ring-2]:ring-inset [&.ring-offset-2]:ring-offset-0"
      data-settings-target={`runtime-${props.harness.id}`}
      data-teammate-runtime={props.harness.name}
    >
      <div class="min-w-0 flex-1">
        <RuntimeName harness={props.harness} />
        <p class="mt-0.5 pl-4 text-xs text-ink-extra-muted">
          {props.harness.connected
            ? t('runtimeSharing.online')
            : t('runtimeSharing.offline')}
          {' · '}
          <span class={requested() ? 'font-medium text-accent-ink' : undefined}>
            {t('runtimeSharing.yourAccess', { access: accessLabel() })}
          </span>
        </p>
      </div>
      <div class="flex shrink-0 flex-wrap items-center justify-end gap-1 @max-[480px]:justify-start @max-[480px]:pl-2">
        <Show when={canAsk()}>
          <RuntimeAccessAction harnessId={props.harness.id} />
        </Show>
        <RuntimeOptions harness={props.harness} />
        <Show when={props.canRemove}>
          <ConnectAction
            label="Remove"
            variant="danger"
            onClick={props.onRemove}
          />
        </Show>
      </div>
    </div>
  );
}
