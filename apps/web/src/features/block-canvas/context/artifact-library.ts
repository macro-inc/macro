import type { ArtifactLibrary } from '@macro-inc/graphics/loro';
import { type Accessor, createContext, useContext } from 'solid-js';

export const NO_ARTIFACT_LIBRARY: ArtifactLibrary = {
  styles: {},
  components: {},
};

export const ArtifactLibraryContext = createContext<{
  library: Accessor<ArtifactLibrary>;
}>({ library: () => NO_ARTIFACT_LIBRARY });

export const useArtifactLibrary = () => useContext(ArtifactLibraryContext);
