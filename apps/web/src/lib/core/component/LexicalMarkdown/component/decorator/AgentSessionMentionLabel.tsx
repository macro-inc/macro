import AgentIcon from '@icon/wide-star.svg';

/** A session reference uses the same icon and underline treatment as other mentions. */
export function AgentSessionMentionLabel(props: { label: string }) {
  return (
    <span class="pointer-events-auto">
      <span class="relative top-[0.125em] size-[1em] inline-flex mx-1">
        <AgentIcon class="size-full text-chat" />
      </span>
      <span class="underline decoration-current/20 decoration-[max(1px,0.1em)] underline-offset-2">
        {props.label}
      </span>
    </span>
  );
}
