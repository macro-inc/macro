import { For, type JSX } from 'solid-js';

export interface ActionSequenceStep {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  completed?: boolean;
}

export interface ActionSequenceProps {
  steps: ActionSequenceStep[];
  classList?: JSX.CustomAttributes<HTMLOListElement>['classList'];
}

interface ButtonProps {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  completed?: boolean;
}

export function ActionSequence(props: ActionSequenceProps) {
  return (
    <>
      <style>{`
        .action-sequence {
          counter-reset: sequence;
        }

        .action-sequence-item {
          counter-increment: sequence;
        }

        .action-sequence-item::before {
          content: "0" counter(sequence);
          height: calc(var(--spacing) * 4);
          aspect-ratio: 1;
          font-family: var(--font-mono);
          font-size: 0.875rem;
          padding: 0.25rem;
          width: auto;
          font-variant-numeric: tabular-nums;
          color: currentColor;
          box-sizing: content-box;
          border: 2px solid currentColor;
          text-align: center;
          display: flex;
          justify-content: center;
          align-items: center;
          position: absolute;
          right: 100%;
          bottom: -2px;
        }

        .action-sequence-item::after {
          content: "";
          height: 2px;
          width: 1rem;
          position: absolute;
          left: 0;
          bottom: -2px;
          background-color: currentColor;
        }

        .action-sequence-item.completed::before {
          content: "✔";
        }
      `}</style>

      <ol
        class="action-sequence flex flex-col gap-4 pl-8 md:pl-0 md:-ml-4 transition"
        classList={props.classList}
      >
        <For each={props.steps}>
          {(step) => (
            <li
              class="action-sequence-item w-max relative pl-4 text-accent"
              classList={{
                completed: step.completed,
                'text-ink-disabled': step.disabled && !step.completed,
              }}
            >
              <Button
                label={step.label}
                onClick={step.onClick}
                disabled={step.disabled}
                completed={step.completed}
              />
            </li>
          )}
        </For>
      </ol>
    </>
  );
}

function Button(props: ButtonProps) {
  return (
    <button
      type="button"
      class="cursor-pointer relative flex items-stretch bg-accent text-dialog font-mono border-2 border-accent font-medium uppercase leading-none translate-y-[2px] transition py-1 px-2 disabled:cursor-not-allowed"
      disabled={props.disabled || props.completed}
      onClick={props.onClick}
      classList={{
        'translate-y-full hover:glow-dialog bg-transparent border-2 border-accent border-current text-ink-disabled pattern-ink-disabled pattern-diagonal-2':
          props.disabled && !props.completed,
        'hover:glow-accent starting:translate-y-full':
          !props.disabled && !props.completed,
        'bg-transparent text-accent! border-2 border-accent': props.completed,
      }}
    >
      {props.label}
    </button>
  );
}
