import { Checkbox } from '@kobalte/core/checkbox';
import { createSignal, For, Show } from 'solid-js';
import { render } from 'solid-js/web';
import createPresence from 'solid-presence';

function Presence() {
  const [show, setShow] = createSignal(true);
  const [element, setElement] = createSignal<HTMLDivElement | null>(null);
  const presence = createPresence({ show, element });
  return (
    <section>
      <button onClick={() => setShow((value) => !value)}>
        Toggle presence
      </button>
      <output id="presence-state">{presence.state()}</output>
      <Show when={presence.present()}>
        <div
          ref={setElement}
          data-show={show()}
          class="animated"
          id="animated-presence"
        >
          Animation target
        </div>
      </Show>
    </section>
  );
}
function AnimatedCheckbox() {
  const [checked, setChecked] = createSignal(true);
  return (
    <section>
      <button onClick={() => setChecked((value) => !value)}>
        Toggle checkbox
      </button>
      <Checkbox
        checked={checked()}
        onChange={setChecked}
        aria-label="Animated checkbox"
      >
        <Checkbox.Input />
        <Checkbox.Control>
          <Checkbox.Indicator
            id="animated-checkbox"
            class="animated"
            data-show={checked()}
          >
            Check
          </Checkbox.Indicator>
        </Checkbox.Control>
      </Checkbox>
    </section>
  );
}
function Fixture() {
  return (
    <>
      <For each={Array.from({ length: 200 }, (_, i) => i)}>
        {(id) => (
          <Checkbox aria-label={`Check ${id}`}>
            <Checkbox.Input />
            <Checkbox.Control>
              <Checkbox.Indicator forceMount data-static-indicator>
                Check
              </Checkbox.Indicator>
            </Checkbox.Control>
          </Checkbox>
        )}
      </For>
      <Presence />
    </>
  );
}
const root = document.getElementById('root');
if (root)
  render(
    () =>
      new URLSearchParams(location.search).has('kobalte') ? (
        <AnimatedCheckbox />
      ) : (
        <Fixture />
      ),
    root
  );
