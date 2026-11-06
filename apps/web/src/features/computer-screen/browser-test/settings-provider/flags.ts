export function useFeatureFlag() {
  return () => ({
    loading: false,
    enabled: !new URLSearchParams(location.search).has('flag-off'),
  });
}
