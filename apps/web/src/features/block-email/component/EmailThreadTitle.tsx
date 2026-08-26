import { cn } from '@ui/utils/classname';
import { createSignal } from 'solid-js';
import { CopySubjectButton } from './CopySubjectButton';

function lastWordCluster(title: string): { lead: string; last: string } {
  const i = title.lastIndexOf(' ');
  if (i === -1) return { lead: '', last: title };
  return { lead: title.slice(0, i + 1), last: title.slice(i + 1) };
}

export function EmailThreadTitle(props: {
  title: string;
  copyReveal?: 'hover' | 'always';
  class?: string;
}) {
  const [titleHovered, setTitleHovered] = createSignal(false);
  const cluster = () => lastWordCluster(props.title);
  const copyHidden = () => props.copyReveal === 'hover' && !titleHovered();

  return (
    <h1
      class={cn(
        'ph-no-capture block w-full max-w-full min-w-0 text-pretty font-semibold tracking-tight text-ink select-text cursor-text wrap-break-word leading-snug',
        props.class
      )}
      onMouseEnter={() => setTitleHovered(true)}
      onMouseLeave={() => setTitleHovered(false)}
    >
      {cluster().lead}
      <span class={cluster().lead ? 'whitespace-nowrap' : undefined}>
        {cluster().last}
        <CopySubjectButton
          subject={props.title}
          class={cn(
            'ml-1.5 select-none text-inherit transition-opacity',
            copyHidden() ? 'opacity-0' : 'opacity-100'
          )}
        />
      </span>
    </h1>
  );
}
