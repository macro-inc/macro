type ThreadEarlierRepliesProps = {
  count: number;
  onExpand: () => void;
};

/** Compact disclosure above a thread's latest reply preview. */
export function ThreadEarlierReplies(props: ThreadEarlierRepliesProps) {
  return (
    <button
      type="button"
      aria-expanded={false}
      class="rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-hover focus-visible:bg-active focus-visible:outline-none touch:min-h-8"
      onClick={props.onExpand}
    >
      {`Show ${props.count} earlier ${props.count === 1 ? 'reply' : 'replies'}`}
    </button>
  );
}
