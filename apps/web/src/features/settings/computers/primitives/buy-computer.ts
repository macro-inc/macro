import { Telemetry } from '@macro-inc/observability';
import {
  fetchComputers,
  usePurchaseComputerMutation,
} from '@queries/computers/computers';
import type { ComputerSize } from '@service-auth/computers';
import { createSignal, onCleanup } from 'solid-js';
import { match } from 'ts-pattern';
import { purchaseRefusalOf } from '../core/purchase-refusal';
import {
  type BoughtComputerProgress,
  boughtComputerProgress,
  PURCHASE_WAIT_MS,
} from '../core/purchase-wait';
import { waitForProgress } from './wait-for-progress';

/**
 * Where the Buy step is. A refusal keeps the dialog open with the size:
 * - `declined`: the card was refused; nothing was bought. Try again buys
 *   with a new purchase key.
 * - `no_room`: no host has room for `size`; nothing was charged.
 * - `failed`: any other failure, in the computer flow's words.
 */
export type BuyComputerState =
  | { kind: 'choosing' }
  | { kind: 'buying' }
  | { kind: 'declined' }
  | { kind: 'no_room'; size: ComputerSize }
  | { kind: 'failed'; error: unknown };

/** The bought computer, and whether it came up within the wait. */
export type BoughtComputer = { computerId: string; ready: boolean };

async function readProgress(
  computerId: string
): Promise<BoughtComputerProgress | undefined> {
  try {
    return boughtComputerProgress(await fetchComputers(), computerId);
  } catch {
    return undefined;
  }
}

/**
 * Buy a computer and wait in the dialog, up to `PURCHASE_WAIT_MS`, until it
 * is up. One purchase key per dialog, replaced only after a declined card, so
 * a retry never pays twice.
 */
export function useBuyComputer(options: {
  onBought: (bought: BoughtComputer) => void;
}) {
  const purchase = usePurchaseComputerMutation();
  const [state, setState] = createSignal<BuyComputerState>({
    kind: 'choosing',
  });
  const [purchaseKey, setPurchaseKey] = createSignal(crypto.randomUUID());
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });

  const buy = async (size: ComputerSize, name: string | undefined) => {
    if (state().kind === 'buying') return;
    setState({ kind: 'buying' });
    await Telemetry.span('computers.buy', async (span) => {
      span.setAttr('computer.size', size);
      let computerId: string;
      try {
        const bought = await purchase.mutateAsync({
          purchaseKey: purchaseKey(),
          size,
          name,
          parentSpan: span,
        });
        computerId = bought.computerId;
      } catch (error) {
        const refused = purchaseRefusalOf(error);
        span.setAttr('buy.outcome', refused ?? 'failed');
        if (disposed) return;
        if (refused === 'PAYMENT_DECLINED') setPurchaseKey(crypto.randomUUID());
        setState(
          match(refused)
            .returnType<BuyComputerState>()
            .with('PAYMENT_DECLINED', () => ({ kind: 'declined' }))
            .with('NO_ROOM', () => ({ kind: 'no_room', size }))
            .otherwise(() => ({ kind: 'failed', error }))
        );
        return;
      }
      span.setAttr('computer.id', computerId);
      const ending = await span.span('computers.buy.wait_ready', (wait) =>
        waitForProgress({
          read: () => readProgress(computerId),
          waitMs: PURCHASE_WAIT_MS,
          span: wait,
          stopped: () => disposed,
        })
      );
      span.setAttr('buy.outcome', ending);
      if (disposed) return;
      setState({ kind: 'choosing' });
      setPurchaseKey(crypto.randomUUID());
      // A failed or released computer shows on its row, with its Retry.
      options.onBought({ computerId, ready: ending === 'ready' });
    });
  };

  return {
    state,
    purchaseKey,
    buy,
    /** Back to choosing after the size or name changed. */
    edit: () => {
      const current = state().kind;
      if (current === 'no_room' || current === 'failed')
        setState({ kind: 'choosing' });
    },
  };
}
