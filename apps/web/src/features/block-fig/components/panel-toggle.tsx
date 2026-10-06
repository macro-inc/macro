import SidebarSimple from '@phosphor/sidebar-simple.svg';

export function PanelToggle(props: {
  side: 'left' | 'right';
  open: boolean;
  onClick: () => void;
}) {
  const label = () =>
    `${props.open ? 'Hide' : 'Show'} ${props.side === 'left' ? 'layers' : 'properties'}`;
  return (
    <button
      type="button"
      aria-label={label()}
      title={label()}
      data-testid={`fig-toggle-${props.side}`}
      class="flex size-7 shrink-0 items-center justify-center rounded text-ink-muted hover:bg-hover hover:text-ink focus-visible:ring-2 focus-visible:ring-accent"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={props.onClick}
    >
      <SidebarSimple
        class="size-4"
        classList={{ '-scale-x-100': props.side === 'right' }}
      />
    </button>
  );
}
