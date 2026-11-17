import type {
  ArtifactLibrary,
  ArtifactLibraryEdit,
} from '@macro-inc/graphics/loro';
import { type Accessor, createContext, useContext } from 'solid-js';

export const NO_ARTIFACT_LIBRARY: ArtifactLibrary = {
  styles: {},
  components: {},
};

export const ArtifactLibraryContext = createContext<{
  library: Accessor<ArtifactLibrary>;
  /** Absent for viewers and for canvases that are not shared. */
  edit?: (edit: ArtifactLibraryEdit) => void;
}>({ library: () => NO_ARTIFACT_LIBRARY });

export const useArtifactLibrary = () => useContext(ArtifactLibraryContext);
