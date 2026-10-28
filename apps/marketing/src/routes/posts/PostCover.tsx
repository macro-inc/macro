import { type Component, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import AiEditingCover from '../../assets/posts/ai-editing-agents/cover.svg';
import DopplerConfigCover from '../../assets/posts/doppler-config/cover.svg';
import GmailQuotaCover from '../../assets/posts/gmail-rate-limits/cover.svg';
import GraphqlCacheCover from '../../assets/posts/graphql-cache/cover.svg';
import MfsSharingCover from '../../assets/posts/mfs-sharing/cover.svg';
import OpenSourceCover from '../../assets/posts/why-macro-is-open-source/cover.svg';
import SwitchFromClickUp from '../../assets/switch/switch-from-clickup.svg';
import SwitchFromLinear from '../../assets/switch/switch-from-linear.svg';
import SwitchFromNotion from '../../assets/switch/switch-from-notion.svg';
import SwitchFromSlack from '../../assets/switch/switch-from-slack.svg';
import SwitchFromSuperhuman from '../../assets/switch/switch-from-superhuman.svg';

/**
 * Card / hero artwork, keyed by brand: the "switch to Macro" graphics from
 * docs.macro.com/switch-to-macro (competitor app icon → Macro), plus
 * per-post covers drawn in the same tile style.
 */
const SWITCH_GRAPHICS: Record<
  string,
  Component<JSX.SvgSVGAttributes<SVGSVGElement>>
> = {
  notion: SwitchFromNotion,
  slack: SwitchFromSlack,
  linear: SwitchFromLinear,
  superhuman: SwitchFromSuperhuman,
  clickup: SwitchFromClickUp,
  graphql: GraphqlCacheCover,
  mfs: MfsSharingCover,
  'ai-editing': AiEditingCover,
  doppler: DopplerConfigCover,
  'gmail-quota': GmailQuotaCover,
  'open-source': OpenSourceCover,
};

export function PostCover(props: { brand?: string; class?: string }) {
  const graphic = () =>
    props.brand ? SWITCH_GRAPHICS[props.brand] : undefined;
  return (
    <div class={`post-cover${props.class ? ` ${props.class}` : ''}`}>
      <Show when={graphic()}>
        {(g) => (
          <Dynamic component={g()} class="post-cover-svg" aria-hidden="true" />
        )}
      </Show>
    </div>
  );
}
