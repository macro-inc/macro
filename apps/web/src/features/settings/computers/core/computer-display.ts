import { formatLocale, t } from '@app/lib/i18n';
import type {
  ComputerStatus,
  Quote,
  SetupStep,
  SizeOffer,
} from '@service-auth/computers';
import { match } from 'ts-pattern';
import { formatBillingAmount } from '../../core/format-billing-amount';

export function sizeLabel(size: string): string {
  return match(size)
    .with('standard', () => t('computers.standard'))
    .with('large', () => t('computers.large'))
    .with('xl', () => t('computers.xl'))
    .otherwise((unknown) => String(unknown));
}

export function offerSpecs(offer: SizeOffer): string {
  return t('computers.computerSpecs', {
    cpus: offer.vcpus,
    memory: offer.memoryGb,
    disk: offer.diskGb,
  });
}

/** The resources recorded when this computer was purchased. */
export function computerSpecs(computer: ComputerStatus): string {
  return t('computers.computerSpecs', {
    cpus: computer.vcpus,
    memory: computer.memoryGib,
    disk: computer.diskGib,
  });
}

/** "$40/month" from a quote in the currency's smallest unit. */
export function formatQuote(quote: Quote): string {
  const amount = formatBillingAmount(
    quote.amount,
    quote.currency,
    formatLocale()
  );
  const interval = match(quote.interval)
    .with('month', () => t('computers.priceMonthly', { amount }))
    .with('year', () => t('computers.priceYearly', { amount }))
    .exhaustive((interval) =>
      t('computers.priceInterval', { amount, interval: String(interval) })
    );
  return interval;
}

export function formatComputerDate(value: string): string {
  return new Date(value).toLocaleDateString(formatLocale(), {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function setupStepLabel(step: SetupStep): string | undefined {
  return match(step)
    .with('creating', () => t('computers.stepCreating'))
    .with('booting', () => t('computers.stepBooting'))
    .with('connecting', () => t('computers.stepConnecting'))
    .with('ready', () => t('computers.ready'))
    .exhaustive(() => undefined);
}

export type StatusTone = 'success' | 'progress' | 'muted' | 'failure';

export function computerStatusLabel(computer: ComputerStatus): {
  label: string;
  detail?: string;
  tone: StatusTone;
} {
  return match(computer.status)
    .returnType<{ label: string; detail?: string; tone: StatusTone }>()
    .with('setting_up', () => {
      const setup = computer.setup;
      const step = setup && setupStepLabel(setup.step);
      return {
        label: t('computers.settingUp'),
        detail:
          setup && step
            ? t('computers.setupProgress', {
                step,
                position: setup.position,
                total: setup.total,
              })
            : undefined,
        tone: 'progress',
      };
    })
    .with('waiting_for_capacity', () => ({
      label: t('computers.waitingForCapacity'),
      detail: t('computers.waitingForCapacityHint'),
      tone: 'muted',
    }))
    .with('needs_attention', () => ({
      label: t('computers.needsAttention'),
      tone: 'failure',
    }))
    .with('ready', () => ({ label: t('computers.ready'), tone: 'success' }))
    .with('asleep', () => ({
      label: t('computers.asleep'),
      detail: t('computers.wakeHint'),
      tone: 'muted',
    }))
    .with('waking', () => ({ label: t('computers.waking'), tone: 'progress' }))
    .with('stopping', () => ({
      label: t('computers.stopping'),
      tone: 'progress',
    }))
    .with('stopped', () => ({ label: t('computers.stopped'), tone: 'muted' }))
    .with('failed', () => ({
      label: t('computers.failed'),
      detail: t('computers.failedHint'),
      tone: 'failure',
    }))
    .with('payment_failed', () => ({
      label: t('computers.paymentFailed'),
      tone: 'failure',
    }))
    .with('released', () => ({
      label: t('computers.releasedStatus'),
      tone: 'muted',
    }))
    .exhaustive((unknown) => ({ label: String(unknown), tone: 'muted' }));
}

/** Power can change only once a computer is set up and before it is gone. */
export function canTogglePower(computer: ComputerStatus): boolean {
  return match(computer.status)
    .with('ready', 'asleep', 'stopped', 'waiting_for_capacity', () => true)
    .with(
      'setting_up',
      'waking',
      'stopping',
      'failed',
      'payment_failed',
      'needs_attention',
      'released',
      () => false
    )
    .exhaustive(() => false);
}
