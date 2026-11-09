import HardDrivesIcon from '@icon/system/regular/hard-drives.svg';
import type { AgentWithHarnessId } from '@queries/agents/agents';
import type { ComputerStatus } from '@service-auth/computers';
import { Button, cn, ToggleSwitch } from '@ui';
import { type JSX, Show } from 'solid-js';
import { match } from 'ts-pattern';
import { HarnessIcon, StatusDot } from '../../integration-ui';
import { IntegrationRow } from '../../primitives';
import {
  canTogglePower,
  computerSpecs,
  computerStatusLabel,
  formatComputerDate,
  type StatusTone,
  sizeLabel,
} from '../core/computer-display';
import { ComputerAgents } from './computer-agents';

/** The paired runtime a computer's macrod registered as. */
export type ComputerRuntime = {
  name: string;
  connected: boolean;
  claudeMode?: string;
};

function toneClass(tone: StatusTone): string {
  return match(tone)
    .with('success', () => 'bg-success-bg text-success')
    .with('progress', () => 'bg-accent-bg text-accent')
    .with('failure', () => 'bg-failure-bg text-failure')
    .with('muted', () => 'border border-edge-muted text-ink-extra-muted')
    .exhaustive();
}

export function ComputerRow(props: {
  computer: ComputerStatus;
  runtime?: ComputerRuntime;
  /** Agents bound to the computer's harness. */
  agents: readonly AgentWithHarnessId[];
  claudeAccess?: JSX.Element;
  /** Team admins and owners manage power and billing; members only read. */
  canManage: boolean;
  powerPending: boolean;
  billingPending: boolean;
  onPower: (on: boolean) => void;
  onCancel: () => void;
  onKeep: () => void;
  onRelease: () => void;
}) {
  const status = () => computerStatusLabel(props.computer);

  return (
    <IntegrationRow
      icon={
        <HarnessIcon>
          <HardDrivesIcon />
        </HarnessIcon>
      }
      title={props.computer.name}
      badge={
        <span class="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md border border-edge-muted px-2 text-xxs/none font-medium uppercase text-ink-extra-muted">
          {sizeLabel(props.computer.size)}
        </span>
      }
      status={
        <span
          class={cn(
            'inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-[11px]/none font-medium',
            toneClass(status().tone)
          )}
        >
          {status().label}
        </span>
      }
      description={[computerSpecs(props.computer), status().detail]
        .filter(Boolean)
        .join(' · ')}
      facts={
        <span class="flex flex-wrap items-center gap-x-3 gap-y-1">
          {props.claudeAccess}
          <Show when={props.runtime}>
            {(runtime) => (
              <span class="inline-flex items-center gap-1.5">
                <StatusDot
                  state={runtime().connected ? 'connected' : 'disconnected'}
                  label={runtime().connected ? 'Connected' : 'Offline'}
                />
                Runtime {runtime().name}
              </span>
            )}
          </Show>
          <ComputerAgents agents={props.agents} />
          <Show when={props.computer.cancelsAt}>
            {(at) => <span>Cancels {formatComputerDate(at())}</span>}
          </Show>
          <Show when={props.computer.retainedUntil}>
            {(until) => <span>Disk deleted {formatComputerDate(until())}</span>}
          </Show>
        </span>
      }
    >
      <Show when={props.canManage}>
        <Show when={props.computer.status !== 'payment_failed'}>
          <ToggleSwitch
            size="md"
            label="Power"
            labelClass="text-sm text-ink-muted"
            checked={props.computer.poweredOn}
            disabled={props.powerPending || !canTogglePower(props.computer)}
            onChange={(on) => props.onPower(on)}
          />
          <Show
            when={props.computer.cancelsAt}
            fallback={
              <Show when={!props.computer.retainedUntil}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={props.billingPending}
                  onClick={props.onCancel}
                >
                  Cancel at period end
                </Button>
              </Show>
            }
          >
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={props.billingPending}
              onClick={props.onKeep}
            >
              Keep computer
            </Button>
          </Show>
        </Show>
        <Button
          type="button"
          variant="danger"
          size="sm"
          disabled={props.billingPending}
          onClick={props.onRelease}
        >
          {props.computer.status === 'payment_failed'
            ? 'Remove'
            : 'Release now'}
        </Button>
      </Show>
    </IntegrationRow>
  );
}
