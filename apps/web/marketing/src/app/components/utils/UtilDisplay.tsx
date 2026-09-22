import type { ParentProps } from 'solid-js';

interface UtilDisplayProps extends ParentProps {
  when: boolean;
}

export function UtilDisplay(props: UtilDisplayProps) {
  return (
    <div style={{ display: props.when ? 'block' : 'none' }}>
      {props.children}
    </div>
  );
}
