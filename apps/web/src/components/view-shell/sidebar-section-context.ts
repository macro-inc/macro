import { createContext } from 'solid-js';
import type { SectionReorder } from './primitives/create-section-reorder';

/** One controller per rendered sidebar, even when several splits show one view. */
export const SidebarSectionsContext = createContext<{
  reorder: SectionReorder<string>;
}>();

/** The section boundary owns the drag identity shared by its header and body. */
export const SidebarSectionContext = createContext<{
  id: string;
  label: string;
  reorder: SectionReorder<string>;
}>();
