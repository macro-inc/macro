import { createSignal, Show } from 'solid-js';
import { createProductWalkthrough } from '../../primitives/createProductWalkthrough';
import { DemoCursor } from '../DemoCursor';
import { ProductDemo } from '../product/ProductPage';
import { WorkspaceChannel } from '../workspace/WorkspaceChannel';
import { DocumentFrame } from './DocumentFrame';
import { DocumentShareSheet, LAUNCH_MEMBERS } from './DocumentShareSheet';
import {
  createDocumentProject,
  PROJECT_TAGS,
  PROJECT_TITLE,
} from './documentProject';
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
  const w = createDocumentProject();
  w.open('messages', 'website');
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
        'button.sample-inline-reference',
        'button.sample-inline-reference',
        '[data-doc-share]',
        '[data-doc-share]',
        undefined,
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
                    'button.sample-inline-reference'
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
            title={PROJECT_TITLE}
            tags={PROJECT_TAGS}
            onBack={() => {
              setSharing(false);
              setDoc(false);
            }}
            backLabel="Back to #website"
            onShare={() => setSharing(true)}
          >
            <h2>Before we publish</h2>
            <ul class="md-list md-check">
              <li class="checked md-strike text-ink-extra-muted">
                Update the pricing table
              </li>
              <li>Check the copy</li>
              <li>Test signup on mobile</li>
            </ul>
            <h2>Owners</h2>
            <p>
              Julia reviews the copy. Teo checks pricing. Jacob tests signup.
            </p>
          </DocumentFrame>
        </Show>
        <DocumentShareSheet
          open={doc() && sharing()}
          autoFocus={!automatic()}
          title={PROJECT_TITLE}
          channel={{
            members: LAUNCH_MEMBERS,
            level: 'view',
            fresh: automatic(),
          }}
          onClose={() => {
            setSharing(false);
            root
              .querySelector<HTMLButtonElement>('[data-doc-share]')
              ?.focus({ preventScroll: true });
          }}
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
