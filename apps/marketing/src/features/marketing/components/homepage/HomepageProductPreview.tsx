import { createSignal, Match, onCleanup, onMount, Switch } from 'solid-js';
import palette from '../../../../styles/dark-theme.css?inline';
import uiStyles from '../../../../styles/site-ui.css?inline';
import { CallTeamMemoryDemo } from '../calls/CallTeamMemoryDemo';
import HomepageCollaborativeDoc from '../HomepageCollaborativeDoc';
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

/** Reuse the frozen product UI, with sample data, at a consistent desktop scale.
 * These cropped previews are inert; the adjacent links open the full demos. */
export default function HomepageProductPreview(props: {
  kind: HomepagePreviewKind;
}) {
  let host!: HTMLDivElement;
  const [scale, setScale] = createSignal(0.6);
  onMount(() => {
    const measure = () => setScale(host.clientWidth / 640);
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    measure();
    onCleanup(() => observer.disconnect());
  });
  return (
    <div class="macro-product-preview" ref={host} aria-hidden="true" inert>
      <style>{properties}</style>
      <style>{`@scope (.macro-product-canvas) { ${scopedUi} ${palette.replaceAll(':root', ':scope')} }`}</style>
      <div
        class={`macro-product-canvas macro-product-${props.kind}`}
        data-theme-light="false"
        style={{ transform: `scale(${scale()})` }}
      >
        <Switch>
          <Match when={props.kind === 'email'}>
            <HomepageEmailCompose readOnly />
          </Match>
          <Match when={props.kind === 'documents'}>
            <HomepageCollaborativeDoc />
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
            <CallTeamMemoryDemo />
          </Match>
        </Switch>
      </div>
    </div>
  );
}
