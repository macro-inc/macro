import Bell from '@phosphor/bell.svg';
import Calendar from '@phosphor/calendar-blank.svg';
import Check from '@phosphor/check.svg';
import Pencil from '@phosphor/pencil-simple.svg';
import TextAlignLeft from '@phosphor/text-align-left.svg';
import User from '@phosphor/user.svg';
import Users from '@phosphor/users-three.svg';
import X from '@phosphor/x.svg';
import { Button } from '@ui';
import { createSignal, For, onCleanup, onMount, Show } from 'solid-js';
import { homepagePeople } from '../../core/homepage-demo-people';
import type { SampleEvent } from '../../core/workspace-fixtures';

function timeLabel(hour: number) {
  return `${Math.floor(hour) % 12 || 12}${hour % 1 ? ':30' : ''}${hour >= 12 ? 'pm' : 'am'}`;
}

/** Calendar event presentation, backed only by the sample workspace. */
export function WorkspaceEventDetails(props: {
  event: SampleEvent;
  onUpdate: (patch: Partial<SampleEvent>) => void;
  onClose: () => void;
}) {
  const [editing, setEditing] = createSignal(false);
  const [response, setResponse] = createSignal('Yes');
  const handleEscape = (event: KeyboardEvent) => {
    if (event.key === 'Escape') props.onClose();
  };
  onMount(() => window.addEventListener('keydown', handleEscape));
  onCleanup(() => window.removeEventListener('keydown', handleEscape));
  return (
    <div class="sample-event-panel" role="dialog" aria-label="Event details">
      <div class="flex justify-end gap-1 mb-1">
        <Button
          size="icon-sm"
          variant="plain"
          label="Edit event"
          onClick={() => setEditing(!editing())}
        >
          <Pencil />
        </Button>
        <Button
          size="icon-sm"
          variant="plain"
          label="Close event"
          onClick={props.onClose}
        >
          <X />
        </Button>
      </div>
      <Show
        when={editing()}
        fallback={
          <>
            <div class="sample-event-detail-row">
              <span
                class="size-2.5 rounded shrink-0 mt-1.5"
                style={{
                  'background-color':
                    props.event.calendar === 'personal' ? '#60a5d5' : '#74bcc5',
                }}
              />
              <div>
                <h2 class="text-sm font-semibold">{props.event.title}</h2>
                <p class="text-xs text-ink-muted mt-1">
                  {new Date(`${props.event.date}T12:00:00`).toLocaleDateString(
                    'en-US',
                    { weekday: 'short', month: 'long', day: 'numeric' }
                  )}{' '}
                  · {timeLabel(props.event.start)}–
                  {timeLabel(props.event.start + props.event.duration)}
                </p>
              </div>
            </div>
            <div class="sample-event-detail-row">
              <TextAlignLeft />
              <p>{props.event.description}</p>
            </div>
            <div class="sample-event-detail-row">
              <Bell />
              <span>10 minutes before</span>
            </div>
            <div class="sample-event-detail-row">
              <Calendar />
              <span>
                {props.event.calendar === 'personal'
                  ? 'jacob.beckerman@gmail.com'
                  : 'jacob@macro.com'}
              </span>
            </div>
            <div class="sample-event-detail-row">
              <User />
              <img
                class="size-6 rounded-full"
                src={homepagePeople.jacob.photo}
                alt=""
              />
              <span>
                <span class="block text-[10px] text-ink-extra-muted">
                  Organizer
                </span>
                Jacob Beckerman
              </span>
            </div>
            <div class="sample-event-detail-row mt-6">
              <Users />
              <span>4 attendees</span>
            </div>
            <div class="pl-7 pb-4 space-y-3">
              <For each={['jacob', 'julia', 'teo', 'valentina'] as const}>
                {(person) => (
                  <div class="flex items-center gap-3 text-xs text-ink-muted">
                    <img
                      class="size-6 rounded-full"
                      src={homepagePeople[person].photo}
                      alt=""
                    />
                    <span class="flex-1">
                      {homepagePeople[person].name}
                      {person === 'jacob' ? ' (you)' : ''}
                      <span class="block text-[10px] text-ink-extra-muted">
                        {person === 'jacob' ? 'Organizer' : 'Optional'}
                      </span>
                    </span>
                    <Check class="size-3 text-success" />
                  </div>
                )}
              </For>
            </div>
            <div class="sample-event-rsvp">
              <span class="mr-auto">Going?</span>
              <For each={['Yes', 'Maybe', 'No']}>
                {(value) => (
                  <button
                    type="button"
                    aria-pressed={response() === value}
                    onClick={() => setResponse(value)}
                  >
                    {value}
                  </button>
                )}
              </For>
            </div>
          </>
        }
      >
        <label>
          Title
          <input
            aria-label="Event title"
            value={props.event.title}
            onInput={(e) => props.onUpdate({ title: e.currentTarget.value })}
          />
        </label>
        <label>
          Date
          <input
            type="date"
            aria-label="Event date"
            value={props.event.date}
            onInput={(e) => props.onUpdate({ date: e.currentTarget.value })}
          />
        </label>
        <label>
          Start
          <select
            aria-label="Event start"
            value={props.event.start}
            onChange={(e) =>
              props.onUpdate({ start: Number(e.currentTarget.value) })
            }
          >
            <For each={Array.from({ length: 25 }, (_, i) => 8 + i / 2)}>
              {(hour) => <option value={hour}>{timeLabel(hour)}</option>}
            </For>
          </select>
        </label>
        <label>
          Description
          <textarea
            aria-label="Event description"
            value={props.event.description}
            onInput={(e) =>
              props.onUpdate({ description: e.currentTarget.value })
            }
          />
        </label>
        <Button size="sm" onClick={() => setEditing(false)}>
          Done
        </Button>
      </Show>
    </div>
  );
}
