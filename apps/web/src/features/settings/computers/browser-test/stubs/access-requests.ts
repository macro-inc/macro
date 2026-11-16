// Everything else the app imports from it is the real module's.
export * from '../../../../../features/access-requests/access-requests';
export function useShareRequests() {
  return { state: () => undefined };
}
