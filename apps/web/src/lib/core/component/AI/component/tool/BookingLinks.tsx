import Link from '@phosphor-icons/core/regular/link.svg';
import type { BookingLinkResult } from '@service-cognition/generated/tools/types';
import { createSignal, For } from 'solid-js';
import { BaseTool } from './BaseTool';
import { Tool } from './Tool';
import { createToolRenderer, type RenderContext } from './ToolRenderer';

function LinkCard(props: {
  label: string;
  links?: BookingLinkResult[];
  status?: string;
  renderContext: RenderContext['renderContext'];
}) {
  const [expanded, setExpanded] = createSignal(true);
  return (
    <BaseTool
      icon={Link}
      type="call"
      renderContext={props.renderContext}
      response={
        expanded() && props.links ? (
          <Tool.List>
            <For each={props.links}>
              {(link) => (
                <Tool.ListItem icon={<Link class="size-4" />}>
                  <div class="min-w-0 text-xs">
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noreferrer"
                      class="break-words text-accent hover:underline"
                    >
                      {link.draft.event.title}
                    </a>
                    <p class="mt-1 text-ink-muted">
                      {link.draft.event.durationMinutes} minutes ·{' '}
                      {link.draft.event.enabled
                        ? 'Accepting bookings'
                        : 'Paused'}{' '}
                      · {link.draft.schedule.timeZone}
                    </p>
                    <p class="mt-1 break-all text-ink-muted">{link.url}</p>
                  </div>
                </Tool.ListItem>
              )}
            </For>
          </Tool.List>
        ) : undefined
      }
    >
      <span class="min-w-0 flex-1">{props.label}</span>
      <Tool.ResultToggle
        expanded={expanded()}
        onToggle={() => setExpanded((value) => !value)}
        showToggle={!!props.links?.length}
        status={
          props.status ??
          (props.links
            ? `${props.links.length} ${props.links.length === 1 ? 'link' : 'links'}`
            : undefined)
        }
      />
    </BaseTool>
  );
}
export const listBookingLinksHandler = createToolRenderer({
  name: 'ListBookingLinks',
  render: (ctx) => (
    <LinkCard
      label="Booking links"
      links={ctx.response?.data.links}
      renderContext={ctx.renderContext}
    />
  ),
});

function mutationHandler(name: 'CreateBookingLink' | 'EditBookingLink') {
  return createToolRenderer({
    name,
    render: (ctx) => {
      const saved = () => ctx.response?.data;
      return (
        <LinkCard
          label={
            name === 'CreateBookingLink'
              ? 'Create booking link'
              : 'Edit booking link'
          }
          links={saved() ? [saved()!] : undefined}
          status={saved() ? 'Saved' : undefined}
          renderContext={ctx.renderContext}
        />
      );
    },
  });
}
export const createBookingLinkHandler = mutationHandler('CreateBookingLink');
export const editBookingLinkHandler = mutationHandler('EditBookingLink');
