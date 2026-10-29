// A browser-only avatar: the real one needs signed-in inbox links. The thread,
// message, and composer views around it are the production ones.
export function UserIcon(props: { email?: string; class?: string }) {
  return (
    <span
      aria-hidden="true"
      class={`inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-active text-xs ${props.class ?? ''}`}
    >
      {props.email?.[0]?.toUpperCase()}
    </span>
  );
}
