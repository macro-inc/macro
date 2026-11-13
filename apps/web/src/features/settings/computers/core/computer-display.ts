import { formatLocale, t } from '@app/lib/i18n';
import { ThrownResultError } from '@core/util/result';
import type {
  ComputerSize,
  ComputerStatus,
  Quote,
  SetupStep,
  SizeOffer,
} from '@service-auth/computers';
import { match } from 'ts-pattern';
import { formatBillingAmount } from '../../core/format-billing-amount';

export function sizeLabel(size: ComputerSize): string {
  return match(size)
    .with('standard', () => t('computers.standard'))
    .with('large', () => t('computers.large'))
    .with('xl', () => t('computers.xl'))
    .exhaustive();
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
    .with('billing', () => t('computers.stageBilling'))
    .with('creating', () => t('computers.stepCreating'))
    .with('booting', () => t('computers.stepBooting'))
    .with('connecting', () => t('computers.stepConnecting'))
    .with('ready', () => t('computers.ready'))
    .exhaustive(() => undefined);
}

export type StatusTone = 'success' | 'progress' | 'muted' | 'failure';

/** The status a row shows; a purchase still being confirmed shows as setup's
 *  first step. */
export function computerStatusLabel(computer: ComputerStatus): {
  label: string;
  detail?: string;
  tone: StatusTone;
} {
  return match(computer.status)
    .returnType<{ label: string; detail?: string; tone: StatusTone }>()
    .with('setting_up', 'purchasing', () => {
      const setup = computer.setup;
      // Billing comes first; the API's step is a string it may widen before
      // this client's generated type does.
      const reportedStep: string | undefined = setup?.step;
      if (computer.status === 'purchasing' || reportedStep === 'billing') {
        return {
          label: t('computers.settingUp'),
          detail: t('computers.stageBilling'),
          tone: 'progress',
        };
      }
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
    computer.status === 'purchasing' ||
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
      'purchasing',
      'needs_attention',
      'released',
      () => false
    )
    .exhaustive(() => false);
}

/**
 * What to tell the user about a failed computer request: the translated
 * message for a failure the server names, else `fallback`.
 */
export function computerFailureMessage(
  error: unknown,
  fallback: string
): string {
  if (!(error instanceof ThrownResultError)) return fallback;
  return match(error.errors[0]?.code)
    .with('TEAM_ON_TRIAL', () => t('computers.trialBlocked'))
    .with('PURCHASE_CONFLICT', () => t('computers.errorPurchaseConflict'))
    .with('UNPAID_COMPUTER', () => t('computers.errorUnpaidComputer'))
    .with('PAYMENT_FAILED', () => t('computers.errorPaymentFailed'))
    .with('NOT_PURCHASABLE', () => t('computers.errorNotPurchasable'))
    .with('SALES_UNAVAILABLE', () => t('computers.errorSalesUnavailable'))
    .with('COMPUTERS_UNAVAILABLE', () =>
      t('computers.errorComputersUnavailable')
    )
    .with('NOT_RESTORABLE', () => t('computers.errorNotRestorable'))
    .with('NAME_MISMATCH', () => t('computers.errorNameMismatch'))
    .with('NO_PAID_PLAN', () => t('computers.noPaidPlan'))
    .with('ROLLOUT_DISABLED', () => t('computers.rolloutDisabled'))
    .with('BILLING_PROVIDER_FAILED', () => t('computers.errorBillingProvider'))
    .with('TIMED_OUT', () => t('computers.errorTimedOut'))
    .with('NETWORK_ERROR', () => t('computers.errorNetwork'))
    .otherwise(() => fallback);
}

/** Why the sizes could not load, and what gets the team past it. */
export type OffersFailure = {
  message: string;
  /** Billing for a plan problem, a retry for a transient one, else nothing. */
  remedy: 'billing' | 'retry' | 'none';
};

/**
 * What to tell a team whose sizes request failed. Plan problems (a trial,
 * no paid plan) end in Billing; a missing rollout ends nowhere; everything
 * else is worth a retry, named when the cause is known.
 */
export function offersFailure(error: unknown): OffersFailure {
  const code =
    error instanceof ThrownResultError ? error.errors[0]?.code : undefined;
  return match(code)
    .returnType<OffersFailure>()
    .with('TEAM_ON_TRIAL', () => ({
      message: t('computers.trialBlocked'),
      remedy: 'billing',
    }))
    .with('NO_PAID_PLAN', () => ({
      message: t('computers.noPaidPlan'),
      remedy: 'billing',
    }))
    .with('ROLLOUT_DISABLED', () => ({
      message: t('computers.rolloutDisabled'),
      remedy: 'none',
    }))
    .with('COMPUTERS_UNAVAILABLE', () => ({
      message: t('computers.errorComputersUnavailable'),
      remedy: 'retry',
    }))
    .with('BILLING_PROVIDER_FAILED', () => ({
      message: t('computers.errorBillingProvider'),
      remedy: 'retry',
    }))
    .with('TIMED_OUT', () => ({
      message: t('computers.offersTimedOut'),
      remedy: 'retry',
    }))
    .with('NETWORK_ERROR', () => ({
      message: t('computers.errorNetwork'),
      remedy: 'retry',
    }))
    .otherwise(() => ({
      message: t('computers.offersFailed'),
      remedy: 'retry',
    }));
}
