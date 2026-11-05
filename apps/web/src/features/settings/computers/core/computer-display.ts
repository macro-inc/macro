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
    .with('standard', () => 'Standard')
    .with('large', () => 'Large')
    .with('xl', () => 'XL')
    .exhaustive((unknown) => String(unknown));
}

export function offerSpecs(offer: SizeOffer): string {
  return `${offer.vcpus} vCPU · ${offer.memoryGb} GB memory · ${offer.diskGb} GB disk`;
}

/** "$40/month" from a quote in the currency's smallest unit. */
export function formatQuote(quote: Quote): string {
  const amount = new Intl.NumberFormat(undefined, {
    style: 'currency',
    currency: quote.currency.toUpperCase(),
    minimumFractionDigits: quote.amount % 100 === 0 ? 0 : 2,
  }).format(quote.amount / 100);
  const interval = match(quote.interval)
    .with('month', () => 'month')
    .with('year', () => 'year')
    .exhaustive((unknown) => String(unknown));
  return `${amount}/${interval}`;
}

export function formatComputerDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function setupStepLabel(step: SetupStep): string {
  return match(step)
    .with('paying', () => 'Confirming payment')
    .with('creating', () => 'Creating the computer')
    .with('booting', () => 'Starting up')
    .with('connecting', () => 'Connecting to Macro')
    .with('ready', () => 'Ready')
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
      label: 'Setting up',
      detail: computer.setup
        ? `${setupStepLabel(computer.setup.step)} (step ${computer.setup.position} of ${computer.setup.total})`
        : undefined,
      tone: 'progress',
    }))
    .with('ready', () => ({ label: 'Ready', tone: 'success' }))
    .with('asleep', () => ({
      label: 'Asleep',
      detail: 'Wakes when an agent gets a prompt.',
      tone: 'muted',
    }))
    .with('waking', () => ({ label: 'Waking', tone: 'progress' }))
    .with('stopping', () => ({ label: 'Stopping', tone: 'progress' }))
    .with('stopped', () => ({ label: 'Stopped', tone: 'muted' }))
    .with('failed', () => ({
      label: 'Failed',
      detail: 'Macro is looking into it. Contact support if it stays failed.',
      tone: 'failure',
    }))
    .with('payment_failed', () => ({
      label: 'Payment failed',
      tone: 'failure',
    }))
    .with('released', () => ({ label: 'Released', tone: 'muted' }))
    .exhaustive((unknown) => ({ label: String(unknown), tone: 'muted' }));
}

/** Power can change only once a computer is set up and before it is gone. */
export function canTogglePower(computer: ComputerStatus): boolean {
  return match(computer.status)
    .with('ready', 'asleep', 'stopped', () => true)
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
