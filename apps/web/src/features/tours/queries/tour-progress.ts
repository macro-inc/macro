import { createUserScopedStorage } from '@core/util/userScopedStorage';
import { usePutUserKvMutation, useUserKvQuery } from '@queries/user-kv/user-kv';
import { createEffect, on } from 'solid-js';
import {
  parseLegacyTourProgress,
  parseTourProgress,
  TOURS_NAMESPACE,
  type TourProgress,
} from '../core/progress';

/**
 * Progress for one tour, stored in the user's `tours` key-value namespace.
 * Every mounted tour shares one namespace query.
 *
 * `ready` is false until progress has loaded, and stays false if it can't
 * load, so a tour the user already finished never flashes up. Progress
 * saved in localStorage by earlier builds is uploaded once, when the server
 * has nothing for the tour.
 *
 * With `localOnly`, nothing is read or saved: the tour starts fresh on every
 * mount, for iterating on tours locally.
 */
export function createTourProgress(props: {
  tourId: string;
  userId: string;
  localOnly: boolean;
}) {
  const entries = useUserKvQuery(() => TOURS_NAMESPACE, {
    enabled: () => !props.localOnly,
  });
  const put = usePutUserKvMutation();

  const legacy = parseLegacyTourProgress(
    createUserScopedStorage(`macro:tour:${props.tourId}`).read(props.userId)
  );

  const ready = () => props.localOnly || entries.isSuccess;
  const server = () => {
    if (props.localOnly || !entries.isSuccess) return undefined;
    const entry = entries.data.find(({ key }) => key === props.tourId);
    return entry && parseTourProgress(entry.value);
  };
  /** Server progress, or the browser's older copy until it's uploaded. */
  const stored = () =>
    props.localOnly ? undefined : (server() ?? (ready() ? legacy : undefined));

  const save = (progress: TourProgress) => {
    if (props.localOnly) return;
    put.mutate({
      namespace: TOURS_NAMESPACE,
      key: props.tourId,
      value: progress,
    });
  };

  // One-time upload from the browser; the server entry wins afterwards.
  createEffect(
    on(ready, (isReady) => {
      if (isReady && !props.localOnly && legacy && !server()) save(legacy);
    })
  );

  return { ready, stored, save };
}
