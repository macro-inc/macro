export function useFeatureFlag(flag: { key: string }) {
  return () => {
    const params = new URLSearchParams(location.search);
    if (flag.key === 'enable-macro-computers') {
      return {
        loading: params.has('computers-loading'),
        enabled: !params.has('flag-off') && !params.has('computers-off'),
      };
    }
    return { loading: false, enabled: !params.has('agents-off') };
  };
}
