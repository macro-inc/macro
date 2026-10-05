import { createSignal, onCleanup } from 'solid-js';
import type { SchedulingSource } from '../context/scheduling-context';
import { insightPresetRange, insightsQueryRange } from '../core/insights';
import type { Booking } from '../core/types';

/** Keep one report range coherent while filters load, ignoring superseded requests. */
export function createInsightsState(
  source: Pick<SchedulingSource, 'loadInsights'>,
  timeZone: string
) {
  const [range, setRange] = createSignal(insightPresetRange(7, timeZone));
  const [bookings, setBookings] = createSignal<Booking[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string>();
  let request = 0;
  onCleanup(() => request++);
  const load = async (from = range().from, to = range().to) => {
    const id = ++request;
    setRange({ from, to });
    setLoading(true);
    setError(undefined);
    setBookings([]);
    try {
      const bounds = insightsQueryRange(from, to, timeZone);
      const data = await source.loadInsights(bounds.from, bounds.to);
      if (request === id) setBookings(data);
    } catch (e) {
      if (request === id)
        setError(
          e instanceof Error ? e.message : 'Could not load insights. Try again.'
        );
    } finally {
      if (request === id) setLoading(false);
    }
  };
  return { range, bookings, loading, error, load };
}
