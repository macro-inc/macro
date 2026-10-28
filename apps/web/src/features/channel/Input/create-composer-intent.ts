import { fireAndForget } from '@core/util/fireAndForget';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type { InputControls } from '../../universal-input/context/input-session';
import type { Intent } from '../../universal-input/core/input';
import { createInferenceSource } from '../../universal-input/inference';
import { createIntentSuggestion } from '../../universal-input/primitives/intent-suggestion';
import { createSuggestionTelemetry } from '../../universal-input/telemetry';

/**
 * Types worth offering beside a message. `message` is left out because sending
 * one is what the composer already does, so the classifier choosing it is the
 * signal to stay quiet; `search` and `ai` have their own entry points.
 */
const COMPOSER_INTENTS: Intent[] = ['task', 'calendar', 'email', 'note'];

export type ComposerIntentState = {
  /** The type offered for the draft, while the form is closed. */
  suggested: Accessor<Intent | undefined>;
  /** The type the form opened on, so it need not recognize the draft again. */
  accepted: Accessor<Intent | undefined>;
  /** True while the Universal Input form owns the draft above the composer. */
  isOpen: Accessor<boolean>;
  /** Opens the form over the draft; false when nothing was offered. */
  open: () => boolean;
  /** Refuses the offer, or closes the form, leaving the draft in the composer. */
  close: () => void;
  /** Runs the form's action; false when the composer should keep the key. */
  submit: () => boolean;
  captureControls: (controls: InputControls | undefined) => void;
};

/**
 * Recognizes what a channel draft is really for and, once the writer accepts,
 * hands the same text to the Universal Input form above the composer. The
 * composer keeps its editor, its draft and its send throughout: the offer only
 * ever adds a second thing the draft can become.
 */
export function createComposerIntent(options: {
  text: Accessor<string>;
  enabled: Accessor<boolean>;
}): ComposerIntentState {
  const telemetry = createSuggestionTelemetry('channel');
  const inference = createInferenceSource(undefined, 'channel');
  onCleanup(() => {
    telemetry.dispose();
    inference.dispose();
  });
  const suggestion = createIntentSuggestion(options.text, {
    classify: inference.classify,
    offers: () => COMPOSER_INTENTS,
    enabled: options.enabled,
    observe: telemetry.observe,
  });
  const [accepted, setAccepted] = createSignal<Intent>();
  const isOpen = () => accepted() !== undefined;
  const [controls, setControls] = createSignal<InputControls>();

  const retire = () => {
    setAccepted(undefined);
    setControls(undefined);
  };
  const close = () => {
    retire();
    suggestion.dismiss();
  };
  // Sending the draft as a message, or creating it as something else, empties
  // the composer; the form has nothing left to work on either way.
  createEffect(
    on(options.text, (text) => {
      if (!text.trim() && isOpen()) retire();
    })
  );

  return {
    suggested: suggestion.intent,
    accepted,
    isOpen,
    open() {
      const intent = suggestion.intent();
      if (isOpen() || !intent) return false;
      suggestion.accept();
      setAccepted(intent);
      return true;
    },
    close,
    submit() {
      if (!isOpen()) return false;
      // Taken before the lazily loaded form reports its controls, and while it
      // is unready or invalid, so the composer can never send the draft as a
      // message under a form the writer is already looking at.
      const form = controls();
      if (form) fireAndForget(form.submit(), 'channel-input');
      return true;
    },
    captureControls: setControls,
  };
}
