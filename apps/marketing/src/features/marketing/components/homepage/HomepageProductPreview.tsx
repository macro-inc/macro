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
} from '../calls/CallRecord';
import { trainingReview } from '../calls/call-fixtures';
import '../calls/call-stories.css';
import HomepageCrm from '../HomepageCrm';
import HomepageEmailCompose from '../HomepageEmailCompose';
import HomepagePullRequest from '../HomepagePullRequest';
import HomepageSpreadsheet from '../HomepageSpreadsheet';
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

/** Focus each crop on a feature at readable size, using the frozen product UI.
 * These cropped previews are inert; the adjacent links open the full demos. */
export default function HomepageProductPreview(props: {
  kind: HomepagePreviewKind;
}) {
  return (
    <div class="macro-product-preview" aria-hidden="true" inert>
      <style>{properties}</style>
      <style>{`@scope (.macro-product-canvas) { ${scopedUi} ${palette.replaceAll(':root', ':scope')} }`}</style>
      <div
        class={`macro-product-canvas macro-product-${props.kind}`}
        data-theme-light="false"
      >
        <Switch>
          <Match when={props.kind === 'email'}>
            <HomepageEmailCompose readOnly animate={false} />
          </Match>
          <Match when={props.kind === 'documents'}>
            <DocsGraphicFrame>
              <DocsMarkdownScene t={() => REST_T} />
            </DocsGraphicFrame>
          </Match>
          <Match when={props.kind === 'agents'}>
            <HomepagePullRequest />
          </Match>
          <Match when={props.kind === 'spreadsheet'}>
            <HomepageSpreadsheet />
          </Match>
          <Match when={props.kind === 'crm'}>
            <HomepageCrm />
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
    <div class="macro-call-transcript">
      <CallRecordTopBar title={trainingReview.title} />
      <CallTranscriptBox
        segments={trainingReview.segments}
        playback={playback}
        maxHeight={320}
      />
    </div>
  );
}
