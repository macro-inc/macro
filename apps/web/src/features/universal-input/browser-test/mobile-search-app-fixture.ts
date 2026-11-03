import { SearchState } from '../../command/mobile/mobileSearchState';

/** Browser-owned route session; the real search view, sources and dock render together. */
export function createMobileSearchEntry() {
  return SearchState.session();
}

export function useSplitPanelOrThrow() {
  return {
    handle: {
      id: 'mobile-search-fixture',
      currentEntryState: () => undefined,
      registerEntryStateCaptor: () => () => {},
      captureEntryState: () => {},
    },
  };
}

export const useUserId = () => () => 'fixture-account';
export const useIsAuthenticated = () => () => true;
