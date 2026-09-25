import { type JSX, Suspense } from 'solid-js';

type DebugSuspenseProps = {
  name: string;
  children: JSX.Element;
  fallback?: JSX.Element;
};

function DebugSuspenseFallback(
  props: Pick<DebugSuspenseProps, 'name' | 'fallback'>
) {
  console.log(`suspense triggers ${props.name}`);
  return <>{props.fallback}</>;
}

export function DebugSuspense(props: DebugSuspenseProps) {
  return (
    <Suspense
      fallback={
        <DebugSuspenseFallback name={props.name} fallback={props.fallback} />
      }
    >
      {props.children}
    </Suspense>
  );
}
