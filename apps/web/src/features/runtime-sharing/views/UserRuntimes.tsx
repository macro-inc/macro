import { t } from '@app/lib/i18n';
import { useHarnessDirectoryQuery } from '@queries/harnesses/harnesses';
import { For, Show } from 'solid-js';
import { RuntimeAccessAction } from '../components/RuntimeAccessAction';

/** The runtimes a teammate owns, on their user card. */
export function UserRuntimes(props: { userId: string; class?: string }) {
  const directory = useHarnessDirectoryQuery();
  const runtimes = () =>
    directory.isSuccess
      ? directory.data.filter(
          (harness) =>
            harness.owner.type === 'user' &&
            harness.owner.user_id === props.userId
        )
      : [];
  return (
    <Show when={runtimes().length > 0}>
      <section
        class={props.class}
        aria-label={t('runtimeSharing.runtimes')}
        data-user-card-runtimes
      >
        <h3 class="px-1 pb-1 text-xs font-medium text-ink-muted">
          {t('runtimeSharing.runtimes')}
        </h3>
        <For each={runtimes()}>
          {(harness) => (
            <div class="flex min-h-8 items-center justify-between gap-3 px-1 touch:min-h-[44px]">
              <div class="min-w-0">
                <div class="truncate text-sm text-ink">{harness.name}</div>
                <div class="text-xs text-ink-muted">
                  {harness.connected
                    ? t('runtimeSharing.online')
                    : t('runtimeSharing.offline')}
                </div>
              </div>
              <Show when={harness.access === 'none'}>
                <RuntimeAccessAction harnessId={harness.id} />
              </Show>
            </div>
          )}
        </For>
      </section>
    </Show>
  );
}
