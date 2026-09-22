import { Avatar } from '@ui/components/Avatar';
import { createSignal, Show } from 'solid-js';
import { TimelineArtworkBand } from '../../../../marketing/src/app/routes/RouteDocuments';
import { homepagePeople } from '../core/homepage-demo-people';

const versions = [
  {
    time: '9:41 AM',
    author: 'Jacob',
    person: homepagePeople.jacob,
    day: 'Friday',
    note: 'Julia: announcement copy ready. Gabriel: checklist owners confirmed.',
  },
  {
    time: '9:43 AM',
    author: 'Claude',
    person: undefined,
    day: 'Thursday',
    note: 'Julia: announcement copy ready. Gabriel: checklist owners confirmed.',
  },
  {
    time: '9:44 AM',
    author: 'Julia',
    person: homepagePeople.julia,
    day: 'Thursday',
    note: 'Julia: announcement copy ready. Gabriel: checklist owners confirmed.',
  },
];

export function HomepageVersionHistory() {
  const [selected, setSelected] = createSignal(2);
  const version = () => versions[selected()];
  return (
    <div class="homepage-history">
      <div class="homepage-history-document" aria-live="polite">
        <div class="homepage-history-meta">
          <span>Q3 launch plan</span>
          <span class="flex items-center gap-2">
            <Show when={version().person}>
              {(person) => (
                <Avatar size="md" highlightEdge>
                  <Avatar.Image src={person().photo} alt="" />
                  <Avatar.Fallback>{person().initials}</Avatar.Fallback>
                </Avatar>
              )}
            </Show>
            {version().author} · {version().time}
          </span>
        </div>
        <p>
          Launch is confirmed for <mark>{version().day}, 9:00 AM</mark>.
        </p>
        <p>{version().note}</p>
      </div>
      <TimelineArtworkBand
        topGap="0px"
        position={selected() / (versions.length - 1)}
        versionLabel={version().time}
      />
      <label class="homepage-history-control">
        <span>
          Version control{' '}
          <span>
            {selected() + 1} / {versions.length}
          </span>
        </span>
        <input
          type="range"
          min="0"
          max={versions.length - 1}
          step="1"
          value={selected()}
          onInput={(event) => setSelected(event.currentTarget.valueAsNumber)}
          aria-label="Document version"
          aria-valuetext={`${version().author}, ${version().time}, launch on ${version().day}`}
        />
        <span>
          <span>First draft</span>
          <span>Current</span>
        </span>
      </label>
    </div>
  );
}
