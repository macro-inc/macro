interface AddPropertyButtonProps {
  onClick: () => void;
}

export function AddPropertyButton(props: AddPropertyButtonProps) {
  return (
    <button
      class="w-full flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium text-ink-muted hover:text-ink border-2 border-edge hover:border-ink-muted font-mono"
      onClick={props.onClick}
    >
      <span class="text-md leading-none">+ ADD PROPERTY</span>
    </button>
  );
}
