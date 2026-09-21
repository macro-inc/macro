import { Show } from 'solid-js';

function colorForLabel(label: string) {
  const normalized = label.toLowerCase();
  if (/^(to do|todo|not started|backlog|low)$/.test(normalized)) return -1;
  if (/^(medium|normal)$/.test(normalized)) return 3;
  if (
    /^(done|complete[d]?|confirmed|approved|yes|shipped|paid)$/.test(normalized)
  )
    return 0;
  if (/^(in progress|doing|active|in review|invited)$/.test(normalized))
    return 1;
  if (
    /^(blocked|declined|cancelled|canceled|no|overdue|high|urgent|critical)$/.test(
      normalized
    )
  )
    return 2;
  let hash = 0;
  for (const character of label)
    hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return Math.abs(hash) % 5;
}

export function SelectPill(props: {
  label: string;
  empty?: boolean;
  dot?: boolean;
}) {
  const color = () => (props.empty ? -1 : colorForLabel(props.label));
  return (
    <span
      class="inline-flex max-w-full items-center gap-1.5 rounded-md px-2 py-0.5 text-xs leading-5 font-medium"
      classList={{
        'bg-success/10 text-success-ink': color() === 0,
        'bg-accent/10 text-accent-ink': color() === 1,
        'bg-failure/10 text-failure-ink': color() === 2,
        'bg-warning/10 text-warning-ink': color() === 3,
        'bg-violet/10 text-violet-ink': color() === 4,
        'bg-hover text-ink-muted': color() === -1,
      }}
      title={props.label}
    >
      <Show when={props.dot}>
        <span class="size-1.5 shrink-0 rounded-full bg-current opacity-70" />
      </Show>
      <span class="truncate">{props.label}</span>
    </span>
  );
}
