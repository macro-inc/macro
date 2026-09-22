import { EntityIcon } from '@core/component/EntityIcon';
import { HoverCard } from '@core/component/HoverCard';
import { createSignal } from 'solid-js';

/** A local example entity, using the app's icon and hover-card primitives. */
export function HomepageMention(props: {
  kind: 'md' | 'task' | 'email' | 'channel';
  label: string;
  description: string;
  href: string;
}) {
  const [open, setOpen] = createSignal(false);
  return (
    <HoverCard
      triggerAs="span"
      triggerClass="inline"
      triggerTabIndex={-1}
      open={open()}
      onOpenChange={setOpen}
      placement="top"
      openDelay={180}
      closeDelay={150}
      trigger={
        <>
          <a
            class="homepage-mention"
            href={props.href}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onClick={() => setOpen(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setOpen(false);
            }}
          >
            <EntityIcon targetType={props.kind} size="sm" />
            <span>{props.label}</span>
          </a>
          {'\u2060'}
        </>
      }
      content={
        <div class="workspace-demo glass max-w-72 rounded-2xl bg-panel p-4 text-sm text-ink shadow-lg">
          <div class="mb-2 flex items-center gap-2 font-medium">
            <EntityIcon targetType={props.kind} size="sm" />
            <span>{props.label}</span>
          </div>
          <p class="m-0 text-xs leading-5 text-ink-muted">
            {props.description}
          </p>
        </div>
      }
    />
  );
}
