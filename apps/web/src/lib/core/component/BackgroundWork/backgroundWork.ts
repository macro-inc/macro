import { type Accessor, createSignal } from 'solid-js';

/** One piece of work under way in the background, as its pill reads. */
export type BackgroundWorkSummary = {
  /** What is under way, e.g. "Drafting routine". */
  label: string;
  /** How far it has got, after the label. */
  detail?: string;
  /** Opens where the work can be followed; the pill is a button when set. */
  onOpen?: () => void;
};

type Source = Accessor<BackgroundWorkSummary | undefined>;

const [sources, setSources] = createSignal<readonly Source[]>([]);

/**
 * Show work in the global background-work indicator, beside upload progress,
 * while `summary` gives one. Call the result to take it away.
 */
export function showBackgroundWork(summary: Source): () => void {
  setSources((list) => [...list, summary]);
  return () => setSources((list) => list.filter((each) => each !== summary));
}

/** Every piece of background work showing now, oldest first. */
export function backgroundWork(): BackgroundWorkSummary[] {
  return sources().flatMap((source) => {
    const summary = source();
    return summary ? [summary] : [];
  });
}
