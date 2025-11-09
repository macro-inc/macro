import { blockElementSignal } from '@core/signal/blockElement';
import { createCallback } from '@solid-primitives/rootless';
import { createEffect, createSignal, onCleanup, Show } from 'solid-js';
import {
  pageCount,
  useCurrentPageNumber,
  useGetRootViewer,
} from '../signal/pdfViewer';

export function PageNumberInput() {
  // const context = useContext(BarContext);
  // if (!context) throw new Error('PageNumberInput must be used within a Bar');
  // const truncation = context.truncation;

  const getRootViewer = useGetRootViewer();
  const currentPageNumber = useCurrentPageNumber();
  let inputRef: HTMLInputElement | undefined;
  const [intermediateVal, setIntermediate] = createSignal<string>('');

  const inputValue = () => intermediateVal() || currentPageNumber();
  const getPageCount = () => pageCount() ?? 1;

  const getWidthClass = (value: number | string) => {
    const strLength = value.toString().length;
    if (strLength < 2) return 'w-[14px]';
    if (strLength < 3) return 'w-[19px]';
    return 'w-[36px]';
  };

  const onBlur = createCallback((_e: FocusEvent) => {
    const pageNumber = parseInt(intermediateVal(), 10);
    if (Number.isInteger(pageNumber)) {
      getRootViewer()?.scrollTo({ pageNumber });
    } else if (inputRef) {
      inputRef.value = currentPageNumber().toString();
    }
    setIntermediate('');
  });

  const handleKeyDown = createCallback((e: KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'g') {
      e.preventDefault();
      inputRef?.focus();
      inputRef?.select();
    }
  });

  const blockElement = blockElementSignal.get;
  createEffect(() => {
    const element = blockElement();
    if (!element) return;

    element.addEventListener('keydown', handleKeyDown);
    onCleanup(() => {
      element.removeEventListener('keydown', handleKeyDown);
    });
  });

  return (
    <Show when={getPageCount() > 0}>
      <div class="text-sm font-medium text-ink flex align-middle items-center justify-start">
        <div
          class="flex flex-row items-center justify-center"
          onClick={() => inputRef?.select()}
        >
          <div class="px-1 hover:bg-hover hover-transition-bg cursor-default focus:bracket">
            <input
              class={`py-0.5 px-0 text-sm bg-transparent text-ink font-medium cursor-default text-center border-none flex-initial focus:bg-input ${getWidthClass(
                currentPageNumber()
              )}`}
              step="1"
              min="1"
              max={getPageCount().toString()}
              ref={inputRef}
              id="page-number"
              data-testid="topbar-page-number"
              type="number"
              value={inputValue()}
              onChange={(e) => setIntermediate(e.currentTarget.value)}
              onFocus={() => inputRef?.select()}
              onBlur={onBlur}
              onKeyDown={(e) => {
                if (e.key === 'Escape' || e.key === 'Enter') {
                  inputRef?.blur();
                }
              }}
            />
          </div>
          <div class="select-none whitespace-nowrap">
            /&thinsp;{getPageCount()}
          </div>
        </div>
      </div>
    </Show>
  );
}
