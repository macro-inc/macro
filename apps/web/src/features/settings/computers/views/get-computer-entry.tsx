import { t } from '@app/lib/i18n';
import { useSettingsState } from '@core/constant/SettingsState';
import CheckIcon from '@icon/system/regular/check.svg';
import HardDrivesIcon from '@icon/system/regular/hard-drives.svg';
import { useComputerOffersQuery } from '@queries/computers/computers';
import { useIsTeamAdmin } from '@queries/team/teams';
import { Button } from '@ui';
import { For, Show } from 'solid-js';
import { MachineRow } from '../../components/connected-runtimes-section';
import { HarnessIcon } from '../../integration-ui';
import { SettingsCard, SettingsSurface } from '../../primitives';
import { useTeamComputers } from '../primitives/team-computers';
import { fromPriceText, offersBlockedByPlan } from './MacroComputers';

/**
 * The top of Settings → Machines for a team admin who can buy a computer: a
 * large panel with what a computer is, its facts and Get a computer, or one
 * compact row (`compact`). A team on a trial or without a paid plan sees why,
 * with Go to Billing, instead.
 */
export function GetComputerEntry(props: {
  onGet: () => void;
  variant?: 'large' | 'compact';
}) {
  const isAdmin = useIsTeamAdmin();
  const { canPurchase } = useTeamComputers();
  const shown = () => canPurchase() && isAdmin();
  // Runs as soon as the entry shows, so the dialog opens with the sizes.
  const offers = useComputerOffersQuery(shown);
  const settings = useSettingsState();
  const planBlock = () => offersBlockedByPlan(offers);
  const price = (placement: 'leading' | 'inline') =>
    fromPriceText(offers.isSuccess ? offers.data : undefined, placement);
  const facts = () =>
    [
      t('computers.factAlwaysOn'),
      t('computers.factClaudePlans'),
      price('leading'),
    ].filter((fact): fact is string => Boolean(fact));

  const action = (size: 'sm' | 'lg') => (
    <Show
      when={!planBlock()}
      fallback={
        <Button
          type="button"
          variant="secondary"
          size={size}
          class="@max-[480px]/settings-page:w-full"
          onClick={() => settings.openSettings('Billing')}
        >
          {t('computers.trialBillingAction')}
        </Button>
      }
    >
      <Button
        type="button"
        variant="primary"
        size={size}
        class="@max-[480px]/settings-page:w-full"
        onClick={() => props.onGet()}
      >
        {t('computers.getComputerAction')}
      </Button>
    </Show>
  );

  return (
    <Show when={shown()}>
      <div data-settings-target="get-macro-computer">
        <Show
          when={props.variant === 'compact'}
          fallback={
            <SettingsSurface class="flex flex-col gap-5 p-8 @max-[480px]/settings-page:p-5">
              <div class="flex items-start gap-4">
                <HarnessIcon>
                  <HardDrivesIcon />
                </HarnessIcon>
                <div class="min-w-0 flex-1">
                  <h2 class="text-xl/tight font-medium tracking-[-0.015em] text-ink">
                    {t('computers.getComputer')}
                  </h2>
                  <p class="mt-1.5 text-sm leading-relaxed text-ink-muted text-pretty">
                    {planBlock()?.message ?? t('computers.getComputerValue')}
                  </p>
                </div>
              </div>
              <Show when={!planBlock()}>
                <ul class="flex flex-wrap gap-x-6 gap-y-2 pl-13 @max-[480px]/settings-page:flex-col @max-[480px]/settings-page:pl-0">
                  <For each={facts()}>
                    {(fact) => (
                      <li class="flex items-center gap-2 text-sm text-ink">
                        <CheckIcon
                          aria-hidden="true"
                          class="size-4 shrink-0 text-success"
                        />
                        {fact}
                      </li>
                    )}
                  </For>
                </ul>
              </Show>
              <div class="pl-13 @max-[480px]/settings-page:pl-0">
                {action('lg')}
              </div>
            </SettingsSurface>
          }
        >
          <SettingsCard inset="wide">
            <MachineRow
              name={t('computers.getComputer')}
              meta={
                planBlock()?.message ??
                [t('computers.getComputerValueShort'), price('inline')]
                  .filter(Boolean)
                  .join(' · ')
              }
              actions={action('sm')}
            />
          </SettingsCard>
        </Show>
      </div>
    </Show>
  );
}
