import { pressHandlers } from '@ui';
import type { JSX } from 'solid-js';
import './archived-row.css';

export function ArchivedRowRoot(props: {
  title: string;
  onOpen: (event: MouseEvent) => void;
  children: JSX.Element;
}) {
  return (
    <div class="archived-conversation group/archive relative flex h-11 shrink-0 items-center gap-4 rounded-xl px-3 hover:bg-hover focus-within:bg-hover">
      <button
        type="button"
        aria-label={props.title}
        class="absolute inset-0 rounded-xl outline-none focus-visible:outline-2 focus-visible:outline-accent"
        {...pressHandlers(props.onOpen)}
      />
      {props.children}
    </div>
  );
}
