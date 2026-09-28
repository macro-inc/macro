import { UserIcon } from '@core/component/UserIcon';
import { For, Show } from 'solid-js';
import type { RaceStanding } from '../core/games/typing-race';
import { seatColor } from './seat-color';

/** One lane per racer, filled by how much of the passage they have typed. */
export function TypingRaceTrack(props: {
  standings: RaceStanding[];
  /** Racers in their original lane order, so lanes do not jump around. */
  racers: string[];
  passageLength: number;
  viewerId: string | undefined;
  displayName: (userId: string) => string;
}) {
  const standing = (userId: string) =>
    props.standings.find((row) => row.userId === userId);

  return (
    <ul class="flex w-full flex-col gap-2" aria-label="Race progress">
      <For each={props.racers}>
        {(userId, lane) => {
          const row = () => standing(userId);
          const percent = () =>
            props.passageLength === 0
              ? 0
              : Math.min(
                  100,
                  ((row()?.progress?.typed ?? 0) / props.passageLength) * 100
                );
          return (
            <li class="flex items-center gap-3">
              <UserIcon id={userId} size="md" suppressClick />
              <div class="flex min-w-0 flex-1 flex-col gap-1">
                <div class="flex items-center gap-2 text-sm">
                  <span class="min-w-0 truncate font-medium text-ink">
                    {props.displayName(userId)}
                    <Show when={userId === props.viewerId}>
                      <span class="text-ink-subtle"> (you)</span>
                    </Show>
                  </span>
                  <span class="ml-auto shrink-0 text-ink-muted text-xs tabular-nums">
                    <Show
                      when={row()?.progress?.wpm !== undefined}
                      fallback={`${Math.round(percent())}%`}
                    >
                      {row()?.place === 1 ? '🏆 ' : ''}
                      {row()?.progress?.wpm} WPM
                    </Show>
                  </span>
                </div>
                <div class="h-2 overflow-hidden rounded-full bg-hover">
                  <div
                    class="h-full rounded-full transition-[width] duration-300"
                    style={{
                      width: `${percent()}%`,
                      'background-color': seatColor(lane()),
                    }}
                  />
                </div>
              </div>
            </li>
          );
        }}
      </For>
    </ul>
  );
}
