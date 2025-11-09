import { TextButton } from '@core/component/TextButton';
import clickOutside from '@core/directive/clickOutside';
import CheckIcon from '@icon/regular/check.svg';
import XIcon from '@icon/regular/x.svg';
import { createSignal, onCleanup, onMount } from 'solid-js';
import { creatingMemory, useCreateUserMemory } from '../signal';

//@ts-ignore
clickOutside & false;

export function CreateMemory() {
  const [, setCreating] = creatingMemory;
  const createMemory = useCreateUserMemory();
  let editRef: HTMLDivElement | undefined;

  function keyHandler(e: KeyboardEvent) {
    if (
      e.metaKey &&
      e.key === 'Enter' &&
      editRef?.textContent &&
      editRef.textContent.length > 0
    ) {
      createMemory(editRef.textContent);
      setCreating(false);
    }
    if (e.key === 'Escape') setCreating(false);
  }

  onMount(() => {
    if (editRef) editRef.focus();
  });

  const memoryExamples = [
    "I'm a student studying computer science",
    'I live in NYC',
    "I'm learning Javascript and C",
    'My birthday is in July',
    'I prefer short and direct communication',
    'Always provide code examples',
  ];

  const [value, setValue] = createSignal<null | string>('');
  const [activeExample, setActiveExample] = createSignal(0);
  const [visible, setVisible] = createSignal(true);

  const interval = setInterval(() => {
    setVisible(false); // fade out
    setTimeout(() => {
      setActiveExample((p) => (p + 1) % memoryExamples.length);
      setVisible(true); // fade in new text
    }, 300);
  }, 1900);

  onCleanup(() => clearInterval(interval));

  return (
    <div
      class="p-1 flex flex-row w-full items-center text-sm gap-x-1 justify-end relative border-1 border-accent rounded-md"
      use:clickOutside={() => setCreating(false)}
    >
      <div
        ref={editRef}
        contenteditable="plaintext-only"
        onKeyDown={keyHandler}
        onInput={(_) => {
          if (editRef) setValue(editRef?.textContent);
        }}
        class="flex-1"
        contentEditable="plaintext-only"
      />
      <div
        class={` ${visible() ? 'opacity-50' : 'opacity-0'} 
          absolute left-2
          transition-opacity duration-300 ease-in-out select-none  ${value() ? 'hidden' : ''}
          `}
      >
        {memoryExamples[activeExample()]}
      </div>
      <TextButton
        icon={XIcon}
        text="Cancel"
        theme="clear"
        onClick={() => setCreating(false)}
      />
      <TextButton
        icon={CheckIcon}
        text="Create"
        theme="accent"
        onClick={() => {
          if (
            editRef &&
            editRef?.textContent &&
            editRef.textContent.length > 0
          ) {
            createMemory(editRef.textContent);
            setCreating(false);
          }
        }}
      />
    </div>
  );
}
