import { type Accessor, createContext, useContext } from 'solid-js';

/** `compact` shows message images and videos as small thumbnails. */
export type MediaDensity = 'regular' | 'compact';

const REGULAR: Accessor<MediaDensity> = () => 'regular';

export const MediaDensityContext =
  createContext<Accessor<MediaDensity>>(REGULAR);

export function useMediaDensity(): Accessor<MediaDensity> {
  return useContext(MediaDensityContext) ?? REGULAR;
}
