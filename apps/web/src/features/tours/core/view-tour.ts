import type { TourStep } from '@ui/components/Tour';

export type ViewTourVideo = {
  youtubeId: string;
  title: string;
  duration: string;
};

/** What the tour offers to connect when the view's data source isn't linked yet. */
export type ViewTourConnector =
  | { kind: 'email'; label: string }
  | { kind: 'mcp'; label: string; tools: readonly string[] };

export type ViewTourStep = TourStep & {
  /** Shown when the step has a target but nothing to point at and no entry. */
  missingHint?: string;
};

export type ViewTour = {
  /** Stable id; dismissal is saved per user under it. */
  id: string;
  title: string;
  connector?: ViewTourConnector;
  video?: ViewTourVideo;
  steps: readonly ViewTourStep[];
};

/** Identity helper so tour definitions are checked against `ViewTour`. */
export const defineViewTour = (tour: ViewTour) => tour;
