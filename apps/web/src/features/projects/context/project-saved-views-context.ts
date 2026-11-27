import { createContext, useContext } from 'solid-js';
import type { createProjectSavedViews } from '../project-saved-views';

export const ProjectSavedViewsContext =
  createContext<ReturnType<typeof createProjectSavedViews>>();
export const useProjectSavedViews = () => useContext(ProjectSavedViewsContext);
