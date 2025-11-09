import {
  generatedAndWaitingSignal,
  isGeneratingSignal,
} from '@block-md/signal/generateSignal';
import {
  InlineInputDisabled,
  InlineInputLoading,
  InlineInputReady,
} from '@core/component/AI/component/InlineAi';
import { ScopedPortal } from '@core/component/ScopedPortal';
import clickOutside from '@core/directive/clickOutside';
import { createCallback } from '@solid-primitives/rootless';
import type { LexicalEditor } from 'lexical';
import type { Accessor, JSXElement } from 'solid-js';
import {
  createEffect,
  createSignal,
  Match,
  onCleanup,
  onMount,
  Show,
  Switch,
} from 'solid-js';
import { floatWithElement } from '../../directive/floatWithElement';
import { registerEditorWidthObserver } from '../../plugins';
import {
  ACCEPT_COMPLETION,
  type Completion,
  type GenerateMenuOpen,
  REJECT_COMPLETION,
} from '../../plugins/generate/generatePlugin';

export type generateCallback = (userRequest: string) => void;
export type GenerateMenuProps = {
  menuOpen: GenerateMenuOpen;
  generateCallback: generateCallback;
  completionSignal: Accessor<Completion | undefined>;
  editor: LexicalEditor;
};

false && clickOutside;
false && floatWithElement;

function MenuItem(props: {
  onClick: () => void;
  index: number;
  selected: boolean;
  setSelected: (i: number) => void;
  children: JSXElement;
}) {
  return (
    <button
      class={`text-start w-full rounded-sm text-xs p-1 px-2 hover:bg-hover hover-transition-bg ${props.selected ? 'bg-active' : ''} items-center`}
      onClick={props.onClick}
      on:mouseover={() => props.setSelected(props.index)}
    >
      {props.children}
    </button>
  );
}

function GenerateActionMenu(props: GenerateMenuProps) {
  const [selectedIndex, setSelected] = createSignal(0);

  const keyHandler = createCallback((event: KeyboardEvent) => {
    event.preventDefault();
    switch (event.key) {
      case 'ArrowUp':
        setSelected((p) => Math.min(p - 1, 0));
        break;
      case 'ArrowDown':
        setSelected((p) => Math.min(p + 1, 1));
        break;
      case 'Enter':
        if (selectedIndex() === 0) {
          props.editor.dispatchCommand(ACCEPT_COMPLETION, undefined);
        } else {
          props.editor.dispatchCommand(REJECT_COMPLETION, undefined);
        }
        break;
      case 'Tab':
        props.editor.dispatchCommand(ACCEPT_COMPLETION, undefined);
        break;
      case 'Escape':
        if (!isGeneratingSignal()) {
          props.editor.dispatchCommand(REJECT_COMPLETION, undefined);
        }
        break;
    }
  });

  onMount(() => {
    document.addEventListener('keydown', keyHandler);
  });
  onCleanup(() => {
    document.removeEventListener('keydown', keyHandler);
  });

  return (
    <div class="w-fit flex flex-col ring-1 ring-edge rounded-md p-1 bg-menu shadow-md space-y-1">
      <MenuItem
        onClick={() => {
          props.editor.dispatchCommand(ACCEPT_COMPLETION, undefined);
        }}
        selected={selectedIndex() === 0}
        setSelected={setSelected}
        index={0}
      >
        <div class="flex justify-between">
          Accept <span class="pl-4 opacity-50 w-full text-end "> Tab </span>
        </div>
      </MenuItem>
      <MenuItem
        onClick={() => {
          props.editor.dispatchCommand(REJECT_COMPLETION, undefined);
        }}
        selected={selectedIndex() === 1}
        setSelected={setSelected}
        index={1}
      >
        Reject <span class="pl-4 opacity-50 w-full text-end"> Escape </span>
      </MenuItem>
    </div>
  );
}

function InnerGenerateMenu(props: GenerateMenuProps) {
  const [targetWidth, setTargetWidth] = createSignal(400);
  registerEditorWidthObserver(props.editor, setTargetWidth);
  createEffect(() => console.log(targetWidth()));

  const generatedAndWaiting = generatedAndWaitingSignal.get;
  const isGenerating = isGeneratingSignal.get;

  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && !isGenerating()) {
      props.editor.dispatchCommand(REJECT_COMPLETION, undefined);
    }
  };

  onMount(() => {
    document.addEventListener('keydown', keyHandler);
  });

  onCleanup(() => {
    document.removeEventListener('keydown', keyHandler);
  });

  let menuRef!: HTMLDivElement;
  const doneGenerating = () =>
    Boolean(props.completionSignal()?.doneGenerating);

  return (
    <ScopedPortal scope="local">
      <div
        class={`z-100 flex flex-col rounded-md -mt-7`}
        style={{
          width: targetWidth() + 'px',
        }}
        use:floatWithElement={{
          element: () => props.completionSignal()?.parentElement,
        }}
        use:clickOutside={() => {
          if (!generatedAndWaiting() && !isGenerating()) {
            props.editor.dispatchCommand(REJECT_COMPLETION, undefined);
          }
        }}
        ref={menuRef}
      >
        <InputOnceAi
          sendCallback={props.generateCallback}
          isDone={() => {
            const completion = props.completionSignal();
            if (!completion) return false;
            return completion.doneGenerating;
          }}
          closeCallback={() =>
            props.editor.dispatchCommand(REJECT_COMPLETION, undefined)
          }
        />

        <Show when={doneGenerating()}>
          <GenerateActionMenu {...props} />
        </Show>
      </div>
    </ScopedPortal>
  );
}

export function GenerateMenu(props: GenerateMenuProps) {
  const [open] = props.menuOpen;
  return (
    <Show when={open()}>
      <InnerGenerateMenu {...props} />
    </Show>
  );
}

function InputOnceAi(props: {
  sendCallback: (input: string) => void;
  closeCallback: () => void;
  isDone: Accessor<boolean>;
}) {
  const [hasSent, setHasSent] = createSignal(false);
  const [placeholder, setPlaceholder] = createSignal('');
  const sendOnce = (args: string) => {
    setHasSent(true);
    setPlaceholder(args);
    props.sendCallback(args);
  };
  return (
    <div>
      <Switch
        fallback={
          <InlineInputDisabled options={{ placeholderText: placeholder() }} />
        }
      >
        <Match when={!hasSent()}>
          <InlineInputReady
            sendCallback={sendOnce}
            closeInput={props.closeCallback}
            options={{
              closeOnEmptyDelete: true,
              focusOnMount: true,
            }}
          />
        </Match>
        <Match when={!props.isDone() && hasSent()}>
          <InlineInputLoading options={{ placeholderText: placeholder() }} />
        </Match>
      </Switch>
    </div>
  );
}
