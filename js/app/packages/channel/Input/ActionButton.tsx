import { Button } from '@ui/components/Button';
import { LabelAndHotKey } from '@core/component/Tooltip';
import type { JSX } from 'solid-js';

export function InputActionButton(props: {
  label: string;
  onClick?: (event: MouseEvent) => void;
  active?: boolean;
  children: JSX.Element;
}) {
  return (
    <Button
      title={props.label}
      aria-label={props.label}
      tooltip={<LabelAndHotKey label={props.label} />}
      onClick={(event) => props.onClick?.(event)}
      classList={{ 'bg-active': props.active }}
      size="icon-sm"
    >
      {props.children}
    </Button>
  );
}
