import { UserIcon } from '@core/component/UserIcon';
import { For, type JSX, Show } from 'solid-js';
import { seatColor } from './seat-color';

export type SeatDisplay = {
  userId: string;
  name: string;
  /** A short marker such as "X", "O" or a score. */
  marker?: JSX.Element;
  /** Extra detail, such as rounds won. */
  detail?: string;
};

/** Seated players in seat order, with the seat to move highlighted. */
export function PlayerSeats(props: {
  seats: SeatDisplay[];
  turnSeat: number | undefined;
  viewerId: string | undefined;
  winners: string[];
}) {
  return (
    <ul class="flex flex-wrap gap-2" aria-label="Players">
      <For each={props.seats}>
        {(seat, index) => {
          const toMove = () => props.turnSeat === index();
          const won = () => props.winners.includes(seat.userId);
          return (
            <li
              class="flex h-10 min-w-0 items-center gap-2 rounded-xl border bg-panel py-1 pr-3 pl-1.5"
              style={{
                'border-color': toMove() ? seatColor(index()) : undefined,
              }}
              classList={{ 'border-edge-muted': !toMove() }}
              aria-current={toMove() ? 'step' : undefined}
            >
              <span
                aria-hidden="true"
                class="flex size-7 shrink-0 items-center justify-center rounded-lg font-semibold text-accent-contrast text-sm"
                style={{ 'background-color': seatColor(index()) }}
              >
                {seat.marker ?? index() + 1}
              </span>
              <UserIcon id={seat.userId} size="md" suppressClick />
              <span class="min-w-0 truncate font-medium text-ink text-sm">
                {seat.name}
                <Show when={seat.userId === props.viewerId}>
                  <span class="text-ink-subtle"> (you)</span>
                </Show>
              </span>
              <Show when={seat.detail}>
                <span class="shrink-0 text-ink-subtle text-xs tabular-nums">
                  {seat.detail}
                </span>
              </Show>
              <Show when={won()}>
                <span class="shrink-0 text-xs" aria-label="Winner">
                  🏆
                </span>
              </Show>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
