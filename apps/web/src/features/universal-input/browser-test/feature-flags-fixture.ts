/** Deterministic optional editor capabilities; rollout flags are controlled by URL parameters. */
export function useFeatureFlag(flag?: { key: string }) {
  return () => ({
    enabled:
      flag?.key === 'enable-universal-input' &&
      new URLSearchParams(window.location.search).has('eligible') &&
      !(
        flag?.key === 'enable-universal-input' &&
        new URLSearchParams(window.location.search).has('no-universal')
      ),
    loading: false,
  });
}

export function usePosthog() {
  return { flagsLoaded: () => true };
}

export function ShowFeatureFlag(props: {
  flag?: { key: string };
  children?: import('solid-js').JSX.Element;
  fallback?: import('solid-js').JSX.Element;
}) {
  return useFeatureFlag(props.flag)().enabled ? props.children : props.fallback;
}
