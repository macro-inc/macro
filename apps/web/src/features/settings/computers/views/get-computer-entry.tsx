import { t } from '@app/lib/i18n';
import { useSettingsState } from '@core/constant/SettingsState';
import HardDrivesIcon from '@icon/system/regular/hard-drives.svg';
import { useComputerOffersQuery } from '@queries/computers/computers';
import { useIsTeamAdmin } from '@queries/team/teams';
import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';
import { MachineRow } from '../../components/connected-runtimes-section';
import { HarnessIcon } from '../../integration-ui';
import { SettingsCard, SettingsSurface } from '../../primitives';
import { useTeamComputers } from '../primitives/team-computers';
import { fromPriceText, offersBlockedByPlan } from './MacroComputers';

/**
 * The top of Settings → Machines for a team admin who can buy a computer: a
 * panel while the team has none, one row once it has some. A team on a trial
 * or without a paid plan sees why, with Go to Billing, instead.
 */
export function GetComputerEntry(props: { onGet: () => void }) {
  const isAdmin = useIsTeamAdmin();
  const { canPurchase, computers } = useTeamComputers();
  const shown = () => canPurchase() && isAdmin();
  // Runs as soon as the entry shows, so the dialog opens with the sizes.
  const offers = useComputerOffersQuery(shown);
  const settings = useSettingsState();
  const planBlock = () => offersBlockedByPlan(offers);
  const price = (placement: 'leading' | 'inline') =>
    fromPriceText(offers.isSuccess ? offers.data : undefined, placement);

  const action = (size: 'sm' | 'md'): JSX.Element => (
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
          when={computers().length === 0}
          fallback={
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
          }
        >
          <SettingsSurface class="flex items-center gap-4 px-6 py-5 @max-[480px]/settings-page:flex-col @max-[480px]/settings-page:items-stretch">
            <div class="flex min-w-0 flex-1 items-start gap-4">
              <HarnessIcon>
                <HardDrivesIcon />
              </HarnessIcon>
              <div class="min-w-0 flex-1">
                <h2 class="text-base font-medium text-ink">
                  {t('computers.getComputer')}
                </h2>
                <p class="mt-1 text-sm leading-relaxed text-ink-muted text-pretty">
                  {planBlock()?.message ?? t('computers.getComputerValue')}
                </p>
                <Show when={!planBlock() && price('leading')}>
                  {(text) => (
                    <p class="mt-1 text-sm font-medium tabular-nums text-ink">
                      {text()}
                    </p>
                  )}
                </Show>
              </div>
            </div>
            <div class="shrink-0">{action('md')}</div>
          </SettingsSurface>
        </Show>
      </div>
    </Show>
  );
}
