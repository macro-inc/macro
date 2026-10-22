import { Match, Switch } from 'solid-js';
import {
  DocsGraphicFrame,
  DocsMarkdownScene,
  REST_T,
} from '../../../../app/components/featureGraphics/DocsMarkdownScene';
import palette from '../../../../styles/dark-theme.css?inline';
import uiStyles from '../../../../styles/site-ui.css?inline';
import {
  CallRecordTopBar,
  CallTranscriptBox,
  createCallPlayback,
  RecordingPoster,
} from '../calls/CallRecord';
import { trainingReview } from '../calls/call-fixtures';
import '../calls/call-stories.css';
import { homepagePeople } from '../../core/homepage-demo-people';
import { CompanyKanbanCardSurface } from '../DemoCompanyKanban';
import { DocMention } from '../documents/DocMention';
import { HomepageConversation } from '../HomepageConversation';
import HomepageCrm from '../HomepageCrm';
import HomepageEmailCompose from '../HomepageEmailCompose';
import { HomepageMention } from '../HomepageMention';
import HomepagePullRequest from '../HomepagePullRequest';
import HomepageSpreadsheet from '../HomepageSpreadsheet';
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

/** Compose readable fragments of the frozen product UI on a light canvas.
 * Previews are inert; the adjacent links open the full demos. */
export default function HomepageProductPreview(props: {
  kind: HomepagePreviewKind;
}) {
  return (
    <div class="macro-product-preview" aria-hidden="true" inert>
      <style>{properties}</style>
      <style>{`@scope (.macro-product-canvas) { ${scopedUi} ${palette.replaceAll(':root', ':scope')} ${lightPalette} }`}</style>
      <div
        class={`macro-product-canvas workspace-demo macro-product-${props.kind}`}
        data-theme-light="true"
      >
        <Switch>
          <Match when={props.kind === 'email'}>
            <div class="macro-preview-back">
              <HomepageEmailCompose
                readOnly
                draft={{
                  subject: 'Demo follow-up',
                  to: 'Valentina <valentina@coparse.com>',
                  body: 'Here’s the plan for your team.',
                }}
                bodyContent={
                  <p>
                    Here’s the plan for your team.
                    <br />
                    <HomepageMention
                      kind="md"
                      label="Team rollout plan"
                      description="The shared rollout document"
                      href="/demo?document=rollout"
                    />
                  </p>
                }
              />
            </div>
            <div class="macro-preview-front macro-preview-message">
              <HomepageConversation
                messages={[
                  {
                    person: 'julia',
                    text: (
                      <>
                        Can you review my reply?{' '}
                        <HomepageMention
                          kind="email"
                          label="Demo follow-up"
                          description="Shared email thread"
                          href="/email"
                        />
                      </>
                    ),
                  },
                ]}
              />
            </div>
          </Match>
          <Match when={props.kind === 'documents'}>
            <div class="macro-preview-back">
              <DocsGraphicFrame>
                <DocsMarkdownScene t={() => REST_T} />
              </DocsGraphicFrame>
            </div>
            <div class="macro-preview-front macro-preview-task">
              <DocMention
                item={{
                  kind: 'task',
                  label: 'Prepare the launch checklist',
                  status: 'In Progress',
                }}
              />
              <div class="macro-preview-task-meta">
                <span>In Progress</span>
                <img src={homepagePeople.teo.photo} alt="" />
                <span>Teo</span>
              </div>
              <HomepageMention
                kind="md"
                label="Website launch plan"
                description="Linked source document"
                href="/documents"
              />
            </div>
          </Match>
          <Match when={props.kind === 'agents'}>
            <HomepagePullRequest />
          </Match>
          <Match when={props.kind === 'spreadsheet'}>
            <div class="macro-preview-back">
              <div class="macro-preview-sheet">
                <HomepageSpreadsheet />
              </div>
            </div>
            <div class="macro-preview-front macro-preview-company">
              <CompanyKanbanCardSurface
                icon={<span class="homepage-crm-company-mark">C</span>}
                title="Coparse"
                owner={
                  <img
                    class="ml-auto size-6 rounded-full"
                    src={homepagePeople.valentina.photo}
                    alt=""
                  />
                }
                domain="coparse.com"
                updatedAt={<span class="ml-auto">Today</span>}
              />
            </div>
          </Match>
          <Match when={props.kind === 'crm'}>
            <div class="macro-preview-back">
              <HomepageCrm />
            </div>
            <div class="macro-preview-front macro-preview-message">
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
          </Match>
          <Match when={props.kind === 'calls'}>
            <CallPreview />
          </Match>
        </Switch>
      </div>
    </div>
  );
}

function CallPreview() {
  const playback = createCallPlayback(trainingReview.duration);
  return (
    <>
      <div class="macro-preview-back macro-preview-recording">
        <CallRecordTopBar title={trainingReview.title} />
        <RecordingPoster
          tiles={trainingReview.poster}
          speaking={trainingReview.speaking}
        />
      </div>
      <div class="macro-preview-front macro-call-transcript">
        <CallTranscriptBox
          segments={trainingReview.segments.slice(0, 2)}
          playback={playback}
          maxHeight={210}
        />
      </div>
    </>
  );
}
