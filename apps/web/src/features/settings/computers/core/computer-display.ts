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

/** "4 vCPU · 8 GB · 100 GB", for a size shown beside its name. */
export function offerSpecs(offer: SizeOffer): string {
  return t('computers.offerSpecs', {
    cpus: offer.vcpus,
    memory: offer.memoryGb,
    disk: offer.diskGb,
  });
}

/** "Standard · 4 vCPU · 8 GB · 100 GB", as recorded at purchase. */
export function computerSpecs(computer: ComputerStatus): string {
  return t('computers.computerSpecs', {
    size: sizeLabel(computer.size),
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

/** The setup phases a new computer goes through, as both its row and guided
 *  setup show them. */
export const SETUP_PHASES: readonly SetupStep[] = [
  'creating',
  'booting',
  'connecting',
];

/** 0-based index of the computer's current setup phase. */
export function setupPhaseIndex(computer: ComputerStatus): number {
  const step = computer.setup?.step;
  const index = step ? SETUP_PHASES.indexOf(step) : -1;
  return index === -1 ? 0 : index;
}

export function setupStepLabel(step: SetupStep): string | undefined {
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
      // The same three phases guided setup shows; the server's final "ready"
      // step is the Ready status itself.
      const phase = SETUP_PHASES.indexOf(setup?.step ?? 'ready');
      return {
        label: t('computers.settingUp'),
        detail:
          step && phase !== -1
            ? t('computers.setupProgress', {
                step,
                position: phase + 1,
                total: SETUP_PHASES.length,
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
    .with('starting', () => ({
      label: t('computers.starting'),
      tone: 'progress',
    }))
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

/** The status dot every machine row uses, for this computer's state. */
export function computerDotState(
  computer: ComputerStatus
): 'connected' | 'attention' | 'disconnected' {
  return match(computerStatusLabel(computer).tone)
    .with('success', () => 'connected' as const)
    .with('failure', () => 'attention' as const)
    .with('progress', 'muted', () => 'disconnected' as const)
    .exhaustive();
}

/** Provisioning, before the computer first reports ready. */
export function isProvisioning(computer: ComputerStatus): boolean {
  return (
    computer.status === 'setting_up' ||
    computer.status === 'waiting_for_capacity'
  );
}

/** Power can change only once a computer is set up and before it is gone. */
export function canTogglePower(computer: ComputerStatus): boolean {
  return match(computer.status)
    .with('ready', 'stopped', 'waiting_for_capacity', () => true)
    .with(
      'setting_up',
      'starting',
      'stopping',
      'failed',
      'payment_failed',
      'needs_attention',
      'released',
      () => false
    )
    .exhaustive(() => false);
}
