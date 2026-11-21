import { statusError } from '@core/util/safeFetch';
import { match, P } from 'ts-pattern';
import { errorBody } from './databases';

/** CRM validation refusals explain the correction; other statuses stay generic. */
export async function crmValidationError(response: Response) {
  const fallback = statusError(response.status);
  if (response.status !== 400) return fallback;
  const { body } = await errorBody(response);
  return match(body)
    .with({ message: P.string }, ({ message }) => ({
      ...fallback,
      message: message || fallback.message,
    }))
    .otherwise(() => fallback);
}
