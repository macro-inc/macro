import { useComputerOffersQuery } from '@queries/computers/computers';
import type { ComputerStatus } from '@service-auth/computers';
import { For, Show } from 'solid-js';
import { SettingsCard } from '../../primitives';
import {
  computerStatusLabel,
  formatComputerDate,
  formatQuote,
  sizeLabel,
} from '../core/computer-display';
import { useTeamComputers } from '../primitives/team-computers';

/** The Macro computers billed on the team subscription, for Billing. */
export function BillingComputers() {
  const { enabled, computers, failed } = useTeamComputers();
  const offers = useComputerOffersQuery(
    () => enabled() && computers().length > 0
  );

  const price = (computer: ComputerStatus) => {
    const offer = offers.isSuccess
      ? offers.data.find((candidate) => candidate.size === computer.size)
      : undefined;
    return offer ? formatQuote(offer.quote) : undefined;
  };

  return (
    <Show when={enabled() && (computers().length > 0 || failed())}>
      <section
        data-settings-target="macro-computers"
        tabIndex={-1}
        class="flex scroll-mt-4 flex-col gap-4 outline-none"
      >
        <h2 class="text-base font-medium text-ink">Macro computers</h2>
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
                    <Show when={computer.cancelsAt}>
                      {(at) => <> · Cancels {formatComputerDate(at())}</>}
                    </Show>
                  </p>
                </div>
                <Show when={price(computer)}>
                  {(amount) => (
                    <p class="shrink-0 text-sm text-ink">{amount()}</p>
                  )}
                </Show>
              </div>
            )}
          </For>
          <Show when={failed()}>
            <p class="px-4 py-3 text-xs text-negative">
              Could not load your team's computers. Try refreshing this page.
            </p>
          </Show>
        </SettingsCard>
        <p class="px-4 text-xs text-ink-extra-muted">
          Computers are billed on your team subscription. Manage them in
          Settings → Runtimes.
        </p>
      </section>
    </Show>
  );
}
