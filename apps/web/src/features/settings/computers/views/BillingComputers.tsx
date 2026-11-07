import { t } from '@app/lib/i18n';
import { For, Show } from 'solid-js';
import { SettingsCard } from '../../primitives';
import {
  computerSpecs,
  computerStatusLabel,
  formatComputerDate,
  sizeLabel,
} from '../core/computer-display';
import { useTeamComputers } from '../primitives/team-computers';

/** The Macro computers billed on the team subscription, for Billing. */
export function BillingComputers() {
  const { enabled, computers, failed } = useTeamComputers();

  return (
    <Show when={enabled() && (computers().length > 0 || failed())}>
      <section
        data-settings-target="macro-computers"
        tabIndex={-1}
        class="flex scroll-mt-4 flex-col gap-4 outline-none"
      >
        <h2 class="text-base font-medium text-ink">{t('computers.title')}</h2>
        <SettingsCard>
          <For each={computers()}>
            {(computer) => (
              <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
                <div class="min-w-0 flex-1 basis-48">
                  <p class="truncate text-sm font-medium text-ink">
                    {computer.name}
                  </p>
                  <p class="text-xs text-ink-extra-muted">
                    {sizeLabel(computer.size)} ·{' '}
                    {computerStatusLabel(computer).label}
                    {' · '}
                    {computerSpecs(computer)}
                    <Show when={computer.cancelsAt}>
                      {(at) => (
                        <>
                          {' '}
                          ·{' '}
                          {t('computers.cancels', {
                            date: formatComputerDate(at()),
                          })}
                        </>
                      )}
                    </Show>
                  </p>
                </div>
              </div>
            )}
          </For>
          <Show when={failed()}>
            <p class="px-4 py-3 text-xs text-negative">
              {t('computers.loadFailed')}
            </p>
          </Show>
        </SettingsCard>
        <p class="px-4 text-xs text-ink-extra-muted">
          {t('computers.billingHint')}
        </p>
      </section>
    </Show>
  );
}
