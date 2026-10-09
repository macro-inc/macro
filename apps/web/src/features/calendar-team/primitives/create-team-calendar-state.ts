import { type Accessor, createMemo } from 'solid-js';

export interface TeamCalendarSource<T> {
  data: Accessor<T[] | undefined>;
  isPending: Accessor<boolean>;
  isError: Accessor<boolean>;
  isPaused?: Accessor<boolean>;
}

/** Permission errors and scope changes must hide old payloads, even during failed refreshes. */
export function createTeamCalendarState<T>(
  source: TeamCalendarSource<T>,
  enabled: Accessor<boolean>
) {
  const items = createMemo(() =>
    enabled() && !source.isError() && !source.isPaused?.()
      ? (source.data() ?? [])
      : []
  );
  return {
    items,
    isLoading: () => enabled() && source.isPending() && !source.isPaused?.(),
    isError: () =>
      enabled() && (source.isError() || Boolean(source.isPaused?.())),
  };
}
