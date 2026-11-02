import { cn } from '@ui';
import { For } from 'solid-js';
import {
  AGENT_FACE_COLORS,
  AGENT_FACE_STYLES,
  type AgentFaceLook,
} from '../core/agent-face';
import { AgentFace, createDarkTheme } from './agent-face';

/**
 * The face and color choices, as two radio groups: faces drawn in the chosen
 * color, then color swatches.
 */
export function AgentFacePicker(props: {
  /** The look the choices are drawn in. */
  look: AgentFaceLook;
  /**
   * Whether `look` is the agent's current choice. An agent whose picture is
   * an upload, or an older image, has none, so nothing shows as selected.
   */
  chosen?: boolean;
  onChange: (look: AgentFaceLook) => void;
}) {
  const chosen = () => props.chosen ?? true;
  const dark = createDarkTheme();
  return (
    <div class="flex flex-col items-center gap-5">
      <fieldset class="w-full">
        <legend class="sr-only">Face</legend>
        <div class="flex justify-center gap-2">
          <For each={AGENT_FACE_STYLES}>
            {(style) => (
              <label class="group flex flex-col items-center gap-1.5">
                <span
                  class={cn(
                    'flex size-14 items-center justify-center rounded-2xl border border-edge-muted bg-panel/60 transition-[border-color,box-shadow,transform] duration-200',
                    'not-touch:group-hover:border-ink/30 group-has-focus-visible:outline-2 group-has-focus-visible:outline-offset-2 group-has-focus-visible:outline-ink',
                    'group-has-checked:border-ink group-has-checked:shadow-[0_0_0_1px_var(--color-ink)] sm:size-16'
                  )}
                >
                  <input
                    type="radio"
                    name="agent-face-style"
                    value={style.id}
                    class="sr-only"
                    checked={chosen() && props.look.style === style.id}
                    onChange={() =>
                      props.onChange({ ...props.look, style: style.id })
                    }
                  />
                  <AgentFace
                    look={{ ...props.look, style: style.id }}
                    class="size-11 sm:size-12"
                  />
                </span>
                <span class="text-xs text-ink-muted group-has-checked:text-ink">
                  {style.label}
                </span>
              </label>
            )}
          </For>
        </div>
      </fieldset>
      <fieldset>
        <legend class="sr-only">Color</legend>
        <div class="flex justify-center gap-2.5">
          <For each={AGENT_FACE_COLORS}>
            {(color) => (
              <label
                class={cn(
                  'group flex size-9 items-center justify-center rounded-full transition-shadow duration-200 touch:size-11',
                  'has-checked:shadow-[0_0_0_2px_var(--color-ink)] has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-ink'
                )}
              >
                <input
                  type="radio"
                  name="agent-face-color"
                  value={color.id}
                  aria-label={color.label}
                  class="sr-only"
                  checked={chosen() && props.look.color === color.id}
                  onChange={() =>
                    props.onChange({ ...props.look, color: color.id })
                  }
                />
                <span
                  class="size-6 rounded-full shadow-[inset_0_0_0_1px_rgb(0_0_0/0.08)] transition-transform duration-200 not-touch:group-hover:scale-110 touch:size-7"
                  style={{
                    background: color.swatch[dark() ? 'dark' : 'light'],
                  }}
                />
              </label>
            )}
          </For>
        </div>
      </fieldset>
    </div>
  );
}
