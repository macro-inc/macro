import { type JSX, Suspense } from 'solid-js';

type DebugSuspenseProps = {
  name: string;
  children: JSX.Element;
};

function DebugSuspenseFallback(props: Pick<DebugSuspenseProps, 'name'>) {
  console.log(`suspense triggers ${props.name}`);
  return null;
}

export function DebugSuspense(props: DebugSuspenseProps) {
  return (
    <Suspense fallback={<DebugSuspenseFallback name={props.name} />}>
      {props.children}
    </Suspense>
  );
}
