import type { JSX } from 'solid-js';

// Every rollout is on except the GraphQL transports, so calendar reads and
// writes go over the REST routes the tests answer.
export function useFeatureFlag(flag?: { key?: string }) {
  const enabled = !(flag?.key ?? '').includes('graphql');
  return () => ({ enabled, loading: false });
}
export function ShowFeatureFlag(props: { children: JSX.Element }) {
  return <>{props.children}</>;
}
