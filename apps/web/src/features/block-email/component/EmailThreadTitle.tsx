import { cn } from '@ui';
import { CopySubjectButton } from './CopySubjectButton';

function lastWordCluster(title: string): { lead: string; last: string } {
  const i = title.lastIndexOf(' ');
  if (i === -1) return { lead: '', last: title };
  return { lead: title.slice(0, i + 1), last: title.slice(i + 1) };
}

export function EmailThreadTitle(props: {
  title: string;
  copyReveal: 'hover' | 'always';
  class?: string;
}) {
  const cluster = () => lastWordCluster(props.title);

  return (
    <h1
      class={cn(
        'ph-no-capture group/subject max-w-full text-pretty font-semibold tracking-tight text-ink select-text cursor-text',
        props.class
      )}
    >
      {cluster().lead}
      <span class="whitespace-nowrap">
        {cluster().last}
        <CopySubjectButton
          subject={props.title}
          class={cn(
            'ml-1.5 select-none',
            props.copyReveal === 'hover' &&
              'opacity-0 group-hover/subject:opacity-100 focus-visible:opacity-100'
          )}
        />
      </span>
    </h1>
  );
}
