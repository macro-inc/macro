import { prepareHistory } from './harness/history';
import { signEveryoneIn } from './harness/people';

export default async function globalSetup(): Promise<void> {
  await signEveryoneIn();
  await prepareHistory();
}
