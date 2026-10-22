import Pause from '@phosphor/pause.svg';
import Play from '@phosphor/play.svg';
import { createSignal, Match, Show, Switch } from 'solid-js';
import palette from '../../../../styles/dark-theme.css?inline';
import uiStyles from '../../../../styles/site-ui.css?inline';
import { createDemoPointer } from '../../primitives/createDemoPointer';
import { createEmailWalkthrough } from '../../primitives/createEmailWalkthrough';
import { createCallPlayback } from '../calls/CallRecord';
import { trainingReview } from '../calls/call-fixtures';
import '../calls/call-stories.css';
import { DemoCursor } from '../DemoCursor';
import { DocMention } from '../documents/DocMention';
import { HomepageConversation } from '../HomepageConversation';
import HomepageCrm from '../HomepageCrm';
import {
  AgentWorkflow,
  CallWorkflow,
  DocumentWorkflow,
  EmailWorkflow,
  SheetWorkflow,
} from './HomepageWorkflows';
import lightPalette from './homepage-preview-light.css?inline';
import './homepage-product-preview.css';

export type HomepagePreviewKind =
  | 'email'
  | 'documents'
  | 'agents'
  | 'spreadsheet'
  | 'crm'
  | 'calls';
const properties =
  uiStyles.match(/@property[^{}]*\{[^}]*\}/g)?.join('\n') ?? '';
const scopedUi = uiStyles
  .replace(/@(font-face|property)[^{]*\{[^}]*\}/g, '')
  .replaceAll(':root', ':scope');
const stepDelays = [1600, 1000, 1400, 1400, 1300, 1100, 1000];

/** Local fixture actions reuse the product's forms and surfaces, never live data. */
export default function HomepageProductPreview(props: {
  kind: HomepagePreviewKind;
}) {
  let canvas!: HTMLDivElement;
  const [phase, setPhase] = createSignal(0);
  const [cycle, setCycle] = createSignal(1);
  const call = createCallPlayback(trainingReview.duration);
  const advance = (step: number) => {
    setPhase(step);
    if (props.kind === 'calls') {
      if (step === 2) call.seek(29);
      if (step === 4) call.seek(62);
      if (step === 6) call.seek(3);
    }
  };
  const playback = createEmailWalkthrough({
    root: () => canvas,
    steps: stepDelays.length,
    visibilityThreshold: 0.45,
    delay: (step) =>
      props.kind === 'crm' && step === 7 ? 6200 : stepDelays[step - 1],
    loop: { hold: 14000 },
    advance,
    reset: () => {
      setPhase(0);
      setCycle((value) => value + 1);
      call.seek(0);
    },
    reduced: () => {
      setPhase(7);
      call.seek(3);
    },
  });
  const target = () => {
    const step = phase();
    if (step === 0 || step >= 7) return undefined;
    switch (props.kind) {
      case 'email':
        return step === 1
          ? '[data-demo-share-trigger]'
          : step === 2
            ? '.mail-recipient-option'
            : step === 3
              ? '[data-share-message-input]'
              : step <= 5
                ? '.mail-share-submit'
                : '.mail-shared-thread';
      case 'documents':
        return step === 1
          ? '[data-task-selection]'
          : step <= 3
            ? '[data-convert-task]'
            : step === 4
              ? '[data-created-task]'
              : '.macro-preview-task';
      case 'spreadsheet':
        return step <= 2
          ? '[aria-label^="B2:"]'
          : '.macro-company-detail .homepage-mention';
      case 'agents':
        return step < 5 ? '[data-tool-group]' : '.homepage-agent-pr-link';
      case 'calls':
        return step <= 2
          ? '[data-segment="examples"]'
          : step <= 4
            ? '[data-segment="checklists"]'
            : '[data-segment="agenda"]';
      case 'crm':
        return undefined;
    }
  };
  const pointer = createDemoPointer({
    frame: () => canvas,
    target,
    active: () => playback.playing() && !playback.reducedMotion(),
  });
  return (
    <div class="macro-product-preview">
      <style>{properties}</style>
      <style>{`@scope (.macro-product-canvas) { ${scopedUi} ${palette.replaceAll(':root', ':scope')} ${lightPalette} }`}</style>
      <div
        ref={canvas}
        class={`macro-product-canvas workspace-demo macro-product-${props.kind}`}
        data-theme-light="true"
        data-phase={phase()}
        data-paused={!playback.playing()}
        data-cycle={cycle()}
        aria-hidden="true"
        inert
      >
        <Switch>
          <Match when={props.kind === 'email'}>
            <EmailWorkflow phase={phase()} advance={advance} />
          </Match>
          <Match when={props.kind === 'documents'}>
            <DocumentWorkflow phase={phase()} advance={advance} />
          </Match>
          <Match when={props.kind === 'agents'}>
            <AgentWorkflow phase={phase()} />
          </Match>
          <Match when={props.kind === 'spreadsheet'}>
            <SheetWorkflow phase={phase()} />
          </Match>
          <Match when={props.kind === 'crm'}>
            <div class="macro-preview-back">
              <Show when={cycle()} keyed>
                {(_cycle) => <HomepageCrm paused={!playback.playing()} />}
              </Show>
            </div>
            <Show when={phase() >= 6}>
              <div class="macro-preview-front macro-preview-message macro-workflow-result">
                <HomepageConversation
                  messages={[
                    {
                      person: 'claude',
                      text: (
                        <>
                          Moved{' '}
                          <DocMention
                            item={{
                              kind: 'company',
                              label: 'Keystone Mechanical',
                            }}
                          />{' '}
                          to Proposal.
                        </>
                      ),
                    },
                  ]}
                />
              </div>
            </Show>
          </Match>
          <Match when={props.kind === 'calls'}>
            <CallWorkflow phase={phase()} playback={call} />
          </Match>
        </Switch>
        <Show when={pointer()}>
          {(point) => (
            <DemoCursor
              class="macro-workflow-pointer"
              clicking={phase() === 2 || phase() === 4 || phase() === 6}
              style={{ transform: `translate(${point().x}px, ${point().y}px)` }}
            />
          )}
        </Show>
      </div>
      <Show when={!playback.reducedMotion()}>
        <button
          type="button"
          class="macro-workflow-toggle"
          onClick={playback.toggle}
          aria-label={`${playback.playing() ? 'Pause' : 'Play'} ${props.kind} animation`}
          aria-pressed={!playback.playing()}
        >
          <Show when={playback.playing()} fallback={<Play />}>
            <Pause />
          </Show>
        </button>
      </Show>
    </div>
  );
}
