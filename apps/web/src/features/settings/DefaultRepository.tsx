import {
  repositoryLabel,
  sameRepository,
} from '@app/features/agents-view/core/repository';
import { createPreferredRepository } from '@app/features/agents-view/primitives/preferred-repository';
import { createReachableRepositories } from '@app/features/agents-view/queries/reachable-repositories';
import { useSettingsState } from '@core/constant/SettingsState';
import { useUserId } from '@core/context/user';
import { Button } from '@ui';
import { Show } from 'solid-js';
import { SettingsSelect } from './components/settings-select';
import { SettingsCard, SettingsRow, SettingsSection } from './primitives';

/** Personal repository default, using the same accessible GitHub listing as the composer. */
export function DefaultRepository() {
  const userId = useUserId();
  const preferred = createPreferredRepository(userId());
  const reachable = createReachableRepositories(() => true);
  const { openSettings } = useSettingsState();
  const listedPreference = () =>
    reachable.repositories().find((repo) => {
      const url = preferred.repository();
      return url && sameRepository(url, repo.url);
    });
  const unavailable = () =>
    !!preferred.repository() &&
    !reachable.loading() &&
    !reachable.error() &&
    !listedPreference();
  const options = () => {
    const options = [
      { id: 'auto', name: 'Auto-detect' },
      ...reachable
        .repositories()
        .map((repo) => ({ id: repo.url, name: repositoryLabel(repo.url) })),
    ];
    const saved = preferred.repository();
    if (saved && !listedPreference())
      options.push({
        id: saved,
        name: `${repositoryLabel(saved)}${unavailable() ? ' (unavailable)' : ''}`,
      });
    return options;
  };

  return (
    <SettingsSection title="Coding defaults">
      <SettingsCard>
        <SettingsRow
          label="Default repository"
          description="Preselect a GitHub repository for new coding conversations on this device. Auto-detect chooses from your prompt and recent work."
        >
          <div class="w-full min-w-0 max-w-sm">
            <SettingsSelect
              label="Default repository"
              options={options()}
              value={
                listedPreference()?.url ?? preferred.repository() ?? 'auto'
              }
              onChange={(id) =>
                preferred.select(id === 'auto' ? undefined : id)
              }
            />
            <Show when={reachable.loading()}>
              <p class="mt-2 text-xs text-ink-muted" role="status">
                Loading repositories…
              </p>
            </Show>
            <Show when={reachable.error()}>
              <p class="mt-2 text-xs text-ink-muted" role="status">
                Could not load GitHub repositories.
              </p>
              <Button variant="ghost" size="sm" onClick={reachable.retry}>
                Retry
              </Button>
            </Show>
            <Show when={unavailable()}>
              <p class="mt-2 text-xs text-ink-muted" role="status">
                This repository is no longer accessible. New conversations will
                use Auto-detect until you choose another repository or restore
                access.
              </p>
            </Show>
            <Show
              when={
                !reachable.loading() &&
                !reachable.error() &&
                reachable.repositories().length === 0
              }
            >
              <Button
                variant="ghost"
                size="sm"
                onClick={() => openSettings('Connected')}
              >
                Connect GitHub
              </Button>
            </Show>
          </div>
        </SettingsRow>
      </SettingsCard>
    </SettingsSection>
  );
}
