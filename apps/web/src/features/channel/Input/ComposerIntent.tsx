import { lazyNamed } from '@core/util/lazyNamed';
import XIcon from '@icon/system/regular/x.svg';
import { Button } from '@ui';
import { Show, Suspense } from 'solid-js';
import { IntentBadge } from '../../universal-input/components/intent-badge';
import type { ComposerIntentState } from './create-composer-intent';

const ChannelUniversalInput = lazyNamed(
  () => import('../../universal-input/universal-input'),
  'ChannelUniversalInput'
);

/**
 * The offer, then the form, pinned above the composer. Both are the composer's
 * own draft seen another way, so neither replaces the editor below them and
 * neither takes the caret out of it.
 */
export function ComposerIntent(props: {
  state: ComposerIntentState;
  text: string;
  /** Empties the composer once its draft has become something else. */
  onSubmitted: () => void;
}) {
  return (
    // The composer's root spreads its children over whatever height it is
    // given; `mt-auto` takes that space so the offer stays against the editor.
    <div
      data-keep-keyboard
      class="macro-message-width mt-auto flex w-full flex-col items-start gap-2 pb-2"
    >
      <Show
        when={props.state.accepted()}
        keyed
        fallback={
          <Show when={props.state.suggested()}>
            {(intent) => (
              // The offer reads the draft the writer is still typing; taking or
              // refusing it must not move the caret out of the editor.
              <div
                onPointerDown={(event) => event.preventDefault()}
                onMouseDown={(event) => event.preventDefault()}
              >
                <IntentBadge
                  intent={intent()}
                  shortcut="tab"
                  onOpen={() => props.state.open()}
                  onDismiss={props.state.close}
                />
              </div>
            )}
          </Show>
        }
      >
        {(intent) => (
          <Suspense>
            <ChannelUniversalInput
              text={props.text}
              intent={intent}
              editor={null}
              onTextChange={() => {}}
              captureControls={props.state.captureControls}
              onComplete={() => {
                props.state.close();
                props.onSubmitted();
              }}
              onNavigate={props.state.close}
              layout={(parts) => (
                <div
                  class="w-full space-y-2"
                  style={{
                    '--universal-input-max-height':
                      'calc(55 * var(--dvh, 1dvh))',
                    '--universal-input-body-overflow': 'auto',
                  }}
                >
                  <div class="flex justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-keyshortcuts="Escape"
                      onClick={props.state.close}
                    >
                      <XIcon />
                      Back to message
                    </Button>
                  </div>
                  {parts.fields}
                  {parts.result}
                </div>
              )}
            />
          </Suspense>
        )}
      </Show>
    </div>
  );
}
