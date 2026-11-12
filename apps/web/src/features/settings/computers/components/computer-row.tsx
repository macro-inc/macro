import { ListSkeleton } from '@app/components/view-shell/ListSkeleton';
import { t } from '@app/lib/i18n';
import type { ComputerStatus } from '@service-auth/computers';
import type { Harness as RegisteredHarness } from '@service-storage/client';
import { Button } from '@ui';
import { type JSX, Show } from 'solid-js';
import { MachineRow } from '../../components/connected-runtimes-section';
import { StatusDot } from '../../integration-ui';
import {
  computerDotState,
  computerSpecs,
  computerStatusLabel,
  formatComputerDate,
  isProvisioning,
} from '../core/computer-display';
import {
  ComputerActionsMenu,
  type ComputerMenuItem,
} from './computer-actions-menu';

/** How Claude Code on the computer is paid for, as the row shows it. */
export type ComputerClaudeState =
  /** Not chosen yet: guided setup asks. */
  | { kind: 'unset' }
  | { kind: 'loading' }
  | { kind: 'credits' }
  /** The computer's own Claude sign-in; `expired` once it stopped working. */
  | { kind: 'account'; expired: boolean };

/** The row's one action, when it has one. */
export type ComputerPrimaryAction = {
  label: string;
  onClick: () => void;
};

function claudeText(claude: ComputerClaudeState): string | undefined {
  if (claude.kind === 'credits') return t('computers.claudeCredits');
  if (claude.kind === 'loading' || claude.kind === 'unset') return undefined;
  return claude.expired
    ? t('computers.claudeNotSignedIn')
    : t('computers.claudeSignedIn');
}

/**
 * The one line under a computer's name: its specs, then the single state
 * that matters now (setup progress, powered off, a fault, or how Claude is
 * paid for), then its billing: past due, a pending cancellation, or how
 * long a released computer is kept.
 */
function ComputerSubtitle(props: {
  computer: ComputerStatus;
  claude: ComputerClaudeState;
}) {
  const status = () => computerStatusLabel(props.computer);
  const state = () => {
    if (isProvisioning(props.computer))
      return [status().label, status().detail].filter(Boolean).join(' · ');
    if (status().tone !== 'success') return status().label;
    return claudeText(props.claude);
  };
  // Past due, a pending cancellation, or how long a released computer's
  // disk is kept.
  const billing = () => {
    const computer = props.computer;
    if (computer.billing === 'past_due') return t('computers.pastDue');
    if (computer.cancelsAt)
      return t('computers.cancels', {
        date: formatComputerDate(computer.cancelsAt),
      });
    if (computer.retainedUntil)
      return t('computers.keptUntil', {
        date: formatComputerDate(computer.retainedUntil),
      });
    return undefined;
  };
  return (
    <span>
      {[computerSpecs(props.computer), state(), billing()]
        .filter(Boolean)
        .join(' · ')}
      <Show when={!state() && props.claude.kind === 'loading'}>
        {' · '}
        <ListSkeleton.Bar class="inline-block h-2.5 w-28 rounded-full align-middle" />
        <span class="sr-only">{t('common.loading')}</span>
      </Show>
    </span>
  );
}

/**
 * A Macro computer in Settings → Machines, laid out like every other machine
 * row: status dot and name, one muted line, at most one action, and
 * everything else in the ⋯ menu.
 */
export function ComputerRow(props: {
  computer: ComputerStatus;
  claude: ComputerClaudeState;
  primary?: ComputerPrimaryAction;
  share?: ComputerMenuItem;
  menu: readonly ComputerMenuItem[];
  /** Adds the runtime's Don't ask before acting to the menu. */
  harness?: RegisteredHarness;
}): JSX.Element {
  return (
    <MachineRow
      target={
        props.computer.harnessId
          ? `runtime-${props.computer.harnessId}`
          : undefined
      }
      name={props.computer.name}
      dot={
        <StatusDot
          state={computerDotState(props.computer)}
          label={computerStatusLabel(props.computer).label}
        />
      }
      meta={
        <ComputerSubtitle computer={props.computer} claude={props.claude} />
      }
      actions={
        <>
          <Show when={props.primary}>
            {(primary) => (
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={primary().onClick}
              >
                {primary().label}
              </Button>
            )}
          </Show>
          <ComputerActionsMenu
            name={props.computer.name}
            share={props.share}
            items={props.menu}
            harness={props.harness}
          />
        </>
      }
    />
  );
}
