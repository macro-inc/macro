import { clearFavoriteChannels } from '../harness/history';
import { firstCast, signEveryoneIn } from '../harness/people';
import { workers } from '../harness/stack';

/** Signs in the people of every cast the run uses; a sequence makes its own channels. */
export default async function globalSetup(): Promise<void> {
  const casts = Array.from(
    { length: workers() },
    (_, index) => firstCast() + index
  );
  await signEveryoneIn(casts);
  await Promise.all(casts.map((ofCast) => clearFavoriteChannels(ofCast)));
}
