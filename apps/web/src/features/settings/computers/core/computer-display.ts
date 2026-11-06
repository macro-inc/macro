import { formatLocale, t } from '@app/lib/i18n';
import type {
  ComputerSize,
  ComputerStatus,
  Quote,
  SetupStep,
  SizeOffer,
} from '@service-auth/computers';
import { match } from 'ts-pattern';

export function sizeLabel(size: ComputerSize): string {
  return match(size)
    .with('standard', () => t('computers.standard'))
    .with('large', () => t('computers.large'))
    .with('xl', () => t('computers.xl'))
    .exhaustive((unknown) => String(unknown));
}

export function offerSpecs(offer: SizeOffer): string {
  return t('computers.offerSpecs', {
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
  const amount = new Intl.NumberFormat(formatLocale(), {
    style: 'currency',
    currency: quote.currency.toUpperCase(),
    minimumFractionDigits: quote.amount % 100 === 0 ? 0 : 2,
  }).format(quote.amount / 100);
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

function setupStepLabel(step: SetupStep): string {
  return match(step)
    .with('creating', () => t('computers.stepCreating'))
    .with('booting', () => t('computers.stepBooting'))
    .with('connecting', () => t('computers.stepConnecting'))
    .with('ready', () => t('computers.ready'))
    .exhaustive((unknown) => String(unknown));
}

export type StatusTone = 'success' | 'progress' | 'muted' | 'failure';

export function computerStatusLabel(computer: ComputerStatus): {
  label: string;
  detail?: string;
  tone: StatusTone;
} {
  return match(computer.status)
    .returnType<{ label: string; detail?: string; tone: StatusTone }>()
    .with('setting_up', () => ({
      label: t('computers.settingUp'),
      detail: computer.setup
        ? t('computers.setupProgress', {
            step: setupStepLabel(computer.setup.step),
            position: computer.setup.position,
            total: computer.setup.total,
          })
        : undefined,
      tone: 'progress',
    }))
    .with('waiting_for_capacity', () => ({
      label: t('computers.waitingForCapacity'),
      detail: t('computers.waitingForCapacityHint'),
      tone: 'muted',
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
      'released',
      () => false
    )
    .exhaustive(() => false);
}
