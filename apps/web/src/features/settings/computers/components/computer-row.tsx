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
  | { kind: 'account'; account?: string };

/** The row's one action, when it has one. */
export type ComputerPrimaryAction = {
  label: string;
  onClick: () => void;
};

function claudeText(claude: ComputerClaudeState): string | undefined {
  if (claude.kind === 'credits') return t('computers.claudeCredits');
  if (claude.kind === 'loading' || claude.kind === 'unset') return undefined;
  return claude.account
    ? t('computers.claudeOwnAccountAs', { account: claude.account })
    : t('computers.claudeNotSignedIn');
}

/**
 * The one line under a computer's name: its specs, then the single state
 * that matters now (setup progress, powered off, a fault, or how Claude is
 * paid for), then a pending cancellation.
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
  // Once billing has stopped the cancellation is final: it just turns off.
  const cancels = () => {
    const at = props.computer.cancelsAt;
    if (!at) return undefined;
    const date = formatComputerDate(at);
    return props.computer.canUndoCancel === false
      ? t('computers.turnsOff', { date })
      : t('computers.cancels', { date });
  };
  return (
    <span>
      {[computerSpecs(props.computer), state(), cancels()]
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
