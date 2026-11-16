// Everything else the app imports from it is the real module's.
export * from '../../../../../lib/analytics/posthog';
export function useFeatureFlag() {
  return () => ({ enabled: true, loading: false });
}
