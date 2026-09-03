import { useSoupBackfills } from './backfill';

export function SoupBackfillSideEffect(props: { userId: string }) {
  useSoupBackfills(props.userId);
  return null;
}
