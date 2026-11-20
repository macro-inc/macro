import { clearFavoriteChannels, prepareHistory } from './harness/history';
import { firstCast, signEveryoneIn } from './harness/people';
import { workers } from './harness/stack';

export default async function globalSetup(): Promise<void> {
  const casts = Array.from(
    { length: workers() },
    (_, index) => firstCast() + index
  );
  await signEveryoneIn(casts);
  await Promise.all(
    casts.flatMap((ofCast) => [
      prepareHistory(ofCast),
      clearFavoriteChannels(ofCast),
    ])
  );
}
