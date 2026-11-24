import { t } from '@app/lib/i18n';
import { Button } from '@ui/components/Button';
import { Input } from '@ui/components/Input';
import { createSignal, For, Show } from 'solid-js';
import {
  KEYSYM_ALT,
  KEYSYM_CONTROL,
  KEYSYM_ESCAPE,
  KEYSYM_TAB,
} from '../core/keysym';
import { createTextEntry } from '../primitives/text-entry';

const KEYSYM_LEFT = 0xff51;
const KEYSYM_UP = 0xff52;
const KEYSYM_RIGHT = 0xff53;
const KEYSYM_DOWN = 0xff54;

type Modifier = 'control' | 'alt';

/**
 * Typing on a phone: a text field that sends what the phone's own keyboard
 * types, including IME composition and dictation (`createTextEntry`), and a
 * row of keys a phone keyboard lacks. Ctrl and Alt stay down for the next key.
 */
export function KeyBar(props: {
  agentName: string;
  onText: (text: string) => void;
  onKey: (keysym: number, down: boolean) => void;
}) {
  const [modifiers, setModifiers] = createSignal<Modifier[]>([]);

  const modifierKeysym = (modifier: Modifier) =>
    modifier === 'control' ? KEYSYM_CONTROL : KEYSYM_ALT;

  /** Presses one key with the held modifiers, then lets them go. */
  const press = (keysym: number) => {
    const held = modifiers();
    for (const modifier of held) props.onKey(modifierKeysym(modifier), true);
    props.onKey(keysym, true);
    props.onKey(keysym, false);
    for (const modifier of held) props.onKey(modifierKeysym(modifier), false);
    setModifiers([]);
  };

  const typeText = (text: string) => {
    // With a modifier held, one typed letter is a shortcut (Ctrl+C), not text.
    if (modifiers().length > 0 && [...text].length === 1) {
      const codePoint = text.toLowerCase().codePointAt(0);
      if (codePoint !== undefined) press(codePoint);
      return;
    }
    props.onText(text);
  };

  const [composing, setComposing] = createSignal(false);
  const entry = createTextEntry({
    onText: typeText,
    onKey: press,
    onComposingChange: setComposing,
  });

  const keepKeyboard = (event: Event) => event.preventDefault();

  let field: HTMLInputElement | undefined;
  /**
   * After a key is pressed (a tap, or Enter or Space from a tablet's hardware
   * keyboard on a focused key), the text field has the keyboard again, so
   * what is typed next goes to the guest rather than the app.
   */
  const backToField = (event: MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('button'))
      field?.focus({ preventScroll: true });
  };

  const toggle = (modifier: Modifier) =>
    setModifiers((held) =>
      held.includes(modifier)
        ? held.filter((each) => each !== modifier)
        : [...held, modifier]
    );

  const keys = () => [
    { label: t('agentScreen.keyEscape'), keysym: KEYSYM_ESCAPE },
    { label: t('agentScreen.keyTab'), keysym: KEYSYM_TAB },
    { label: '←', name: t('agentScreen.keyLeft'), keysym: KEYSYM_LEFT },
    { label: '↑', name: t('agentScreen.keyUp'), keysym: KEYSYM_UP },
    { label: '↓', name: t('agentScreen.keyDown'), keysym: KEYSYM_DOWN },
    { label: '→', name: t('agentScreen.keyRight'), keysym: KEYSYM_RIGHT },
  ];

  return (
    <div
      class="flex flex-col gap-2 border-t border-edge-divider p-2"
      data-keep-keyboard
    >
      <div class="relative">
        <Input
          ref={(element) => {
            field = element;
            entry.ref(element);
          }}
          size="md"
          aria-label={t('agentScreen.typeToSend', { name: props.agentName })}
          autocapitalize="off"
          enterkeyhint="send"
          onFocus={entry.onFocus}
          onBeforeInput={entry.onBeforeInput}
          onInput={entry.onInput}
          onCompositionStart={entry.onCompositionStart}
          onCompositionEnd={entry.onCompositionEnd}
          onKeyDown={entry.onKeyDown}
        />
        {/* The field always holds a placeholder character (see text-entry), so its own placeholder never shows. */}
        <Show when={!composing()}>
          <span class="pointer-events-none absolute inset-y-0 left-3 flex items-center text-base text-ink-placeholder touch:left-2">
            {t('agentScreen.typeToSend', { name: props.agentName })}
          </span>
        </Show>
      </div>
      {/* Keeps the text field focused, so the phone keyboard stays up: both
          events, on the whole row (gaps too), since WKWebView still
          synthesises a mousedown after a cancelled pointerdown. */}
      <div
        class="flex flex-wrap gap-1.5"
        onPointerDown={keepKeyboard}
        onMouseDown={keepKeyboard}
        onClick={backToField}
      >
        <Button
          size="sm"
          variant="secondary"
          aria-pressed={modifiers().includes('control')}
          onClick={() => toggle('control')}
        >
          {t('agentScreen.keyControl')}
        </Button>
        <Button
          size="sm"
          variant="secondary"
          aria-pressed={modifiers().includes('alt')}
          onClick={() => toggle('alt')}
        >
          {t('agentScreen.keyAlt')}
        </Button>
        <For each={keys()}>
          {(key) => (
            <Button
              size="sm"
              variant="secondary"
              aria-label={key.name ?? key.label}
              onClick={() => press(key.keysym)}
            >
              {key.label}
            </Button>
          )}
        </For>
      </div>
    </div>
  );
}
