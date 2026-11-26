import type { TopicHue } from '../core/topics';

type TopicLook = {
  /** A row's tile and the glyph on it. */
  tile: string;
  /** The square beside its name in the sidebar. */
  square: string;
};

const LOOKS: Record<TopicHue, TopicLook> = {
  blue: { tile: 'bg-blue/15 text-blue', square: 'bg-blue' },
  violet: { tile: 'bg-violet/15 text-violet', square: 'bg-violet' },
  orange: { tile: 'bg-orange/15 text-orange', square: 'bg-orange' },
  teal: { tile: 'bg-teal/15 text-teal', square: 'bg-teal' },
  pink: { tile: 'bg-pink/15 text-pink', square: 'bg-pink' },
  yellow: { tile: 'bg-yellow/15 text-yellow', square: 'bg-yellow' },
};

/** A topic's colour, on its rows' tiles and beside its name. */
export function topicLook(hue: TopicHue): TopicLook {
  return LOOKS[hue];
}
