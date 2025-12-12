import { createSignal, type JSX, onMount } from 'solid-js';

interface ScrollContainerProps {
  children: JSX.Element;
  thumbSize?: number;
}

export function ScrollContainer(props: ScrollContainerProps) {
  const [scrollHeight, setScrollHeight] = createSignal(0);
  const [clientHeight, setClientHeight] = createSignal(0);
  const [scrollTop, setScrollTop] = createSignal(0);

  const thumbSize = 80;
  let scrollContainerRef!: HTMLDivElement;

  function handleScroll(e: Event) {
    const target = e.target as HTMLDivElement;
    setScrollTop(target.scrollTop);
    setScrollHeight(target.scrollHeight);
    setClientHeight(target.clientHeight);
  }

  onMount(() => {
    setScrollHeight(scrollContainerRef.scrollHeight);
    setClientHeight(scrollContainerRef.clientHeight);
  });

  function thumbTop() {
    const maxScroll = scrollHeight() - clientHeight();
    const maxThumbTop = clientHeight() - thumbSize;
    return maxScroll > 0 ? (scrollTop() / maxScroll) * maxThumbTop : 0;
  }

  return (
    <div class="relative w-[800px] h-[400px]">
      <div
        class="w-[800px] h-[400px] border border-[#666] overflow-y-auto overflow-x-hidden scrollbar-hide"
        style={{ 'scrollbar-width': 'none' }}
        ref={scrollContainerRef}
        onScroll={handleScroll}
      >
        {props.children}
      </div>

      <div class="absolute top-0 right-0 w-[1px] h-full bg-transparent">
        <div
          class="absolute right-0 w-[1px] bg-red-600"
          style={{
            height: `${thumbSize}px`,
            top: `${thumbTop()}px`,
          }}
        />
      </div>
    </div>
  );
}
