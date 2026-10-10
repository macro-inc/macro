import { createSignal, Match, Show, Switch } from 'solid-js';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ViewShell } from '../DemoWorkspaceChrome';
import { ProductDemo } from '../product/ProductPage';
import { ChannelCallsList } from './CallChannel';
import {
  CallRecordBody,
  CallRecordTopBar,
  createCallPlayback,
} from './CallRecord';
import { createCallSession } from './CallSession';
import { trainingReview } from './call-fixtures';
import { createDemoPointer } from './demo-pointer';
import './call-stories.css';

/** A channel call shared with the team, then opened by someone who missed it. */
export function CallTeamMemoryDemo() {
  let root!: HTMLDivElement;
  let scroller: HTMLDivElement | undefined;
  const [aim, setAim] = createSignal<string>();
  const [clicking, setClicking] = createSignal(false);
  const [automatic, setAutomatic] = createSignal(true);
  const [phase, setPhase] = createSignal(0);
  const [shared, setShared] = createSignal(true);
  const [query, setQuery] = createSignal('');
  const player = createCallPlayback(trainingReview.duration);
  const session = createCallSession([{ person: 'teo' }], [], 'julia');
  const open = () => {
    player.pause();
    player.seek(0);
    setPhase(2);
  };
  const end = () => {
    session.setJoined(false);
    setPhase(1);
  };
  const revealMoment = () => {
    const line = scroller?.querySelector<HTMLElement>(
      '[aria-label="Go to 1:02: Julia"]'
    );
    if (scroller && line)
      scroller.scrollTop +=
        line.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top -
        200;
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 9,
    reset: () => {},
    delay: (step) =>
      [0, 1800, 600, 200, 1600, 600, 200, 3800, 600, 200][step] ?? 2000,
    reduced: () => {
      setAim(undefined);
      setShared(true);
      open();
    },
    advance: (step) => {
      setClicking(step === 2 || step === 5 || step === 8);
      if (step === 1) setAim('[aria-label="Leave call"]');
      if (step === 3) {
        setAim(undefined);
        end();
      }
      if (step === 4 && shared()) setAim('[role="gridcell"]');
      if (step === 6 && shared()) {
        setAim(undefined);
        open();
      }
      if (step === 7 && shared()) {
        revealMoment();
        setAim('[aria-label="Go to 1:02: Julia"]');
      }
      if (step === 9 && shared()) {
        player.seek(62);
        setAim(undefined);
      }
    },
  });
  const interact = () => {
    setAutomatic(false);
    setAim(undefined);
    playback.pause();
  };
  const pointer = createDemoPointer({
    frame: () => root,
    target: aim,
    active: automatic,
  });
  return (
    <div ref={root} class="call-team-memory">
      <ProductDemo
        label="A teammate catches up on a shared call"
        height={620}
        mobileHeight={660}
        onInteract={interact}
      >
        <Switch>
          <Match when={phase() === 0}>
            <ViewShell.TopBar>
              <span class="text-sm font-medium">#launch · Training prep</span>
            </ViewShell.TopBar>
            <div class="call-memory-sharing">
              <label>
                <input
                  type="checkbox"
                  checked={shared()}
                  onChange={(e) => setShared(e.currentTarget.checked)}
                />{' '}
                Share with team
              </label>
            </div>
            {session.view({ time: '11:02 AM', onLeave: end })}
          </Match>
          <Match when={phase() === 1}>
            <ViewShell.TopBar>
              <span class="text-sm font-medium">Calls</span>
            </ViewShell.TopBar>
            <ChannelCallsList
              search={query()}
              onSearch={setQuery}
              onOpen={open}
              fresh="training"
              rows={
                shared()
                  ? [
                      {
                        id: 'training',
                        title: trainingReview.title,
                        summary:
                          'Keep training to 30 minutes. Julia finishes the slides today.',
                        transcript: trainingReview.segments
                          .map((s) => s.text)
                          .join(' '),
                        status: 'missed',
                        duration: '12m 4s',
                        people: trainingReview.people,
                        time: 'Just now',
                      },
                    ]
                  : []
              }
            />
            {!shared() && (
              <p class="p-4 text-sm text-ink-muted">
                This call wasn’t shared with Gabriel’s team.
              </p>
            )}
          </Match>
          <Match when={phase() === 2}>
            <CallRecordTopBar
              title={trainingReview.title}
              onBack={() => {
                player.pause();
                setPhase(1);
              }}
            />
            <CallRecordBody
              call={trainingReview}
              playback={player}
              transcriptHeight={270}
              class="call-record-compact"
              scrollRef={(el) => {
                scroller = el;
              }}
            />
          </Match>
        </Switch>
      </ProductDemo>
      <Show when={pointer()}>
        {(point) => (
          <DemoCursor
            label=""
            clicking={clicking()}
            class="call-memory-pointer"
            style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
          />
        )}
      </Show>
    </div>
  );
}
