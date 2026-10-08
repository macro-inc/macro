/** Supplies the row and viewport measurements JSDOM does not implement. */
export class GridResizeObserver implements ResizeObserver {
  constructor(private readonly callback: ResizeObserverCallback) {}
  observe(target: Element) {
    const height = target.querySelector('[role="grid"]') ? 400 : 41;
    const size = { inlineSize: 800, blockSize: height };
    this.callback(
      [
        {
          target,
          contentRect: new DOMRect(0, 0, 800, height),
          borderBoxSize: [size],
          contentBoxSize: [size],
          devicePixelContentBoxSize: [size],
        },
      ],
      this
    );
  }
  unobserve() {}
  disconnect() {}
}
