import { createSignal, Show } from 'solid-js';
import { createDummyWorkspace } from '../../primitives/createDummyWorkspace';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ProductDemo } from '../product/ProductPage';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { DocumentFrame } from './DocumentFrame';
import { DocumentShareSheet, LAUNCH_MEMBERS } from './DocumentShareSheet';
import { controlPoint, createAnchor } from './documentScene';

/**
 * Mentioning a doc in a channel gives that channel access. Jacob opens the
 * doc from #launch and its Share modal already lists the channel.
 * Phases: 0 channel, 1 point at the mention, 2 click, 3 doc open, point at
 * Share, 4 click, 5 Share modal open.
 */
export function DocumentSharingDemo() {
  let root!: HTMLDivElement;
  let overlay: HTMLDivElement | undefined;
  const w = createDummyWorkspace('messages');
  w.setData('channels', (c) => c.id === 'launch', 'messages', [
    {
      id: 'demo-video',
      person: 'gabriel',
      body: 'Product demo is recorded. I dropped the link in the announcement draft.',
      time: '9:12 AM',
    },
    {
      id: 'invite-fix',
      person: 'teo',
      body: 'Invite fix is in review. Should land this afternoon.',
      time: '9:20 AM',
    },
    {
      id: 'announcement',
      person: 'julia',
      body: 'Announcement draft is done. I’ll schedule it once Teo’s fix ships.',
      time: '9:24 AM',
    },
    {
      id: 'plan',
      person: 'jacob',
      body: 'Plan for Thursday is up. Comments welcome @[Q3 launch plan](demo-mention:plan)',
      time: '9:31 AM',
    },
  ]);
  w.open('messages', 'launch');
  const [phase, setPhase] = createSignal(0);
  const [automatic, setAutomatic] = createSignal(true);
  const [doc, setDoc] = createSignal(false);
  const [sharing, setSharing] = createSignal(false);
  const finish = () => {
    setDoc(true);
    setSharing(true);
    setPhase(5);
  };
  const playback = createProductWalkthrough({
    root: () => root,
    steps: 5,
    reset: () => {},
    reduced: () => {
      setAutomatic(false);
      finish();
    },
    delay: (step) => [0, 1000, 800, 350, 1000, 350][step] ?? 600,
    advance: (step) => {
      if (step === 3) setDoc(true);
      if (step === 5) setSharing(true);
      setPhase(step);
    },
  });
  const pause = () => {
    setAutomatic(false);
    playback.pause();
  };
  const pointer = createAnchor({
    frame: () => overlay?.parentElement ?? undefined,
    track: phase,
    target: () => {
      if (!automatic()) return;
      const selector = [
        undefined,
        '[data-demo-mention="plan"]',
        '[data-demo-mention="plan"]',
        '[data-doc-share]',
        '[data-doc-share]',
        '[data-channel-access] .doc-share-level',
      ][phase()];
      return selector ? { selector, place: controlPoint } : undefined;
    },
  });
  return (
    <div ref={root} class="doc-story">
      <ProductDemo
        label="Mention a doc in a channel and the channel can open it"
        onInteract={pause}
        height={560}
        mobileHeight={660}
      >
        <Show
          when={doc()}
          fallback={
            // Mentions in the channel open the doc, as they do in the app.
            <div
              class="contents"
              onClick={(event) => {
                if (
                  (event.target as HTMLElement).closest(
                    '[data-demo-mention="plan"]'
                  )
                )
                  setDoc(true);
              }}
            >
              <WorkspaceChannel workspace={w} />
            </div>
          }
        >
          <DocumentFrame
            title="Q3 launch plan"
            tags={['Launch', 'Product']}
            onBack={() => {
              setSharing(false);
              setDoc(false);
            }}
            backLabel="Back to #launch"
            onShare={() => setSharing(true)}
          >
            <h2>Launch checklist</h2>
            <ul class="md-list md-check">
              <li class="checked md-strike text-ink-extra-muted">
                Finalize the product story
              </li>
              <li>Send the customer email</li>
              <li>Publish the changelog</li>
            </ul>
            <h2>Owners</h2>
            <p>
              Julia owns the announcement and the customer email. Teo owns the
              deploy and release checks. Jacob owns customer conversations.
            </p>
          </DocumentFrame>
        </Show>
        <DocumentShareSheet
          open={doc() && sharing()}
          title="Q3 launch plan"
          channel={{
            members: LAUNCH_MEMBERS,
            level: 'view',
            fresh: automatic(),
          }}
          onClose={() => setSharing(false)}
        />
        <div ref={overlay} class="doc-story-overlay" aria-hidden="true">
          <Show when={automatic() && pointer()}>
            {(point) => (
              <DemoCursor
                label="Jacob"
                class="doc-story-cursor doc-story-glide"
                clicking={phase() === 2 || phase() === 4}
                style={{
                  transform: `translate(${point().x}px, ${point().y}px)`,
                }}
              />
            )}
          </Show>
        </div>
      </ProductDemo>
    </div>
  );
}
