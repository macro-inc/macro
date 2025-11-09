// based on https://www.smashingmagazine.com/2021/02/css-z-index-large-projects/

// Utils
const base = 0;
const above = 1; // use this for all values above the base

// Viewer Layout
export const zMainViewLayout = base;
export const zUserHighlight = above + zMainViewLayout;
export const zAnnotationLayer = above + zUserHighlight;
export const zPageOverlay = above + zAnnotationLayer;
export const zPlaceable = above + zPageOverlay;
// NOTE: not working properly due to floating portal moving element out of the stacking context
export const zPlaceableOptionsMenu = above + zPlaceable;
export const zHighlightMenu = zPlaceableOptionsMenu;
export const zViewerDefinitionLookup = above + zPlaceableOptionsMenu;
export const zPopupViewer = above + zViewerDefinitionLookup;
export const zSimpleSearch = above + zPopupViewer;
export const zSelectorMenu = above + zSimpleSearch;

// we add the popup viewer stacking context to the previous items because the popup viewer is a child of the viewer
// multiplying by 10 to ensure the following items are above the popup viewer and its children (I think this is handled by the z-index stacking context anyway)
export const zSignUpBanner = 10 * above + zSimpleSearch;
export const zViewerDocumentLoadingSpinner = above + zSignUpBanner;
export const zViewerNotificationModal = above + zSignUpBanner;

// Navigation Bars
export const zTopBarLayout = above + zViewerNotificationModal;
// NOTE: side panel is above top bar because editor top bar isn't resizing so we want to keep the side panel above it
export const zSidePanelLayout = above + zTopBarLayout; // Side Panel Layout (LHS Recent Files + RHS AI Side Panel)
export const zItemOptionsMenu = above + zSidePanelLayout;
export const zActionMenu = zItemOptionsMenu;
export const zMobileNavBar = above + zActionMenu;
export const zSidePanelSearchAndFilter = above + zMobileNavBar;

// Modal
export const zModalOverlay = above + zSidePanelSearchAndFilter;
export const zModal = above + zModalOverlay;
export const zModalContent = above + zModal;

export const zToastRegion = above + zModalContent;

// Full Page Modal (there can only be one at a time)
export const zFullPageModalBase = base + 100;

export const zCustomCursorTooltip = zFullPageModalBase + 100;

export const zDrag = zSidePanelLayout + 100;

// Tooltip should always be the highest z-index, yes?
export const zToolTip = zDrag + above;
