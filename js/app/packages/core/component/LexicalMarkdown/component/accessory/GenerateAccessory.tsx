import type { LexicalEditor, NodeKey } from 'lexical';
import {
  type Accessor,
  createMemo,
  createSignal,
  For,
  onMount,
  Show,
} from 'solid-js';
import { Transition } from 'solid-transition-group';
import { glueToElement } from '../../directive/glueToElement';

false && glueToElement;

const TypingAnimationManager = (() => {
  const animationStartTime = Date.now();
  const animationDuration = 1400;

  const styleElement = document.createElement('style');
  styleElement.textContent = `
    @keyframes typingDotAnimation {
      0%, 100% {
        opacity: 0.2;
        transform: translateY(0);
      }
      50% {
        opacity: 1;
        transform: translateY(-2px);
      }
    }

    .typing-dot {
      display: inline-block;
      font-size: 36px;
      line-height: 10px;
      font-weight: bold;
      color: currentColor;
      animation: typingDotAnimation 1.4s infinite;
    }
  `;
  document.head.appendChild(styleElement);

  return {
    getAnimationStyle: (dotIndex: number) => {
      const currentTime = Date.now();
      const timeSinceStart = currentTime - animationStartTime;
      const phaseInCycle =
        (timeSinceStart % animationDuration) / animationDuration;
      const baseDelay = -phaseInCycle * animationDuration;

      const dotDelay = dotIndex * 200;
      const totalDelay = baseDelay + dotDelay;

      return `animation-delay: ${totalDelay}ms;`;
    },
  };
})();

const hasWaitedSignal = createSignal<boolean>(false);
let timer: ReturnType<typeof setTimeout>;

export function GenerateAccessory(props: {
  floatRef: HTMLElement;
  editor: LexicalEditor;
  nodeKey: NodeKey;
  isGenerating: Accessor<boolean>;
}) {
  const [hasWaited, setHasWaited] = hasWaitedSignal;
  onMount(() => {
    setHasWaited(false);
    clearTimeout(timer);
    timer = setTimeout(() => {
      setHasWaited(true);
    }, 500);
  });

  const shouldShow = createMemo<boolean>(() => {
    if (!props.isGenerating()) {
      return false;
    }

    const waited = hasWaited();
    if (waited) {
      props.floatRef.style.paddingBottom = '30px';
    }
    return waited;
  });

  return (
    <Show when={shouldShow()}>
      <div
        class="pointer-events-none"
        use:glueToElement={{
          element: () => props.floatRef,
          editor: props.editor,
        }}
      >
        <div class="absolute left-0 bottom-3.5 w-full">
          <Transition
            name="typing-indicator-message"
            appear
            enterActiveClass="transition-opacity duration-300 ease-in"
            enterClass="opacity-0"
            enterToClass="opacity-100"
          >
            <div class="my-1.5 flex gap-[5px]">
              <For each={Array(4).fill(0)}>
                {(_, index) => (
                  <span
                    class="typing-dot"
                    style={TypingAnimationManager.getAnimationStyle(index())}
                  >
                    .
                  </span>
                )}
              </For>
            </div>
          </Transition>
        </div>
      </div>
    </Show>
  );
}
