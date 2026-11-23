import {
  clearFavoriteChannels,
  clearNotifications,
  prepareHistory,
} from './harness/history';
import { checkBrowserSeesConnection } from './harness/network';
import { firstCast, signEveryoneIn } from './harness/people';
import { workers } from './harness/stack';

export default async function globalSetup(): Promise<void> {
  const casts = Array.from(
    { length: workers() },
    (_, index) => firstCast() + index
  );
  await checkBrowserSeesConnection();
  await signEveryoneIn(casts);
  await Promise.all(
    casts.flatMap((ofCast) => [
      prepareHistory(ofCast),
      clearFavoriteChannels(ofCast),
    ])
  );
  // After the history, whose messages notify too.
  await Promise.all(casts.map((ofCast) => clearNotifications(ofCast)));
}
