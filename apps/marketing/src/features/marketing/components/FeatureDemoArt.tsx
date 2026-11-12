import { type JSX, Show } from 'solid-js';
import { FeatureDemoBackdrop } from './FeatureDemoBackdrop';
import {
  HomepageConversation,
  type HomepageMessage,
} from './HomepageConversation';
import './feature-demo-art.css';

export type FeatureDemoComposition = {
  tone:
    | 'email'
    | 'chat'
    | 'documents'
    | 'tasks'
    | 'agents'
    | 'calls'
    | 'crm'
    | 'github';
  message?: HomepageMessage;
  glassFrame?: boolean;
};

/** Keep the working demo intact, with its related conversation outside the workspace. */
export function FeatureDemoArt(props: {
  composition: FeatureDemoComposition;
  children: JSX.Element;
}) {
  return (
    <div
      class="feature-demo-art"
      data-tone={props.composition.tone}
      data-glass-frame={props.composition.glassFrame !== false || undefined}
      data-native-context={!props.composition.message}
    >
      <FeatureDemoBackdrop />
      <div class="feature-demo-primary">{props.children}</div>
      <Show when={props.composition.message}>
        {(message) => (
          <div class="feature-demo-context" inert aria-hidden="true">
            <HomepageConversation messages={[message()]} />
          </div>
        )}
      </Show>
    </div>
  );
}
