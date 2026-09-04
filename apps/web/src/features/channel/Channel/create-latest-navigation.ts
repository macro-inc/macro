/** A latest-page request survives loading/layout, but never a newer navigation. */
export function createLatestNavigation(options: {
  loadLatest: () => Promise<unknown> | void;
  /** Return false until the latest page has a usable viewport. */
  scroll: () => boolean;
}) {
  type Request = { phase: 'loading' | 'waiting-for-layout' };
  let pending: Request | undefined;

  const cancel = () => {
    pending = undefined;
  };

  const onLayout = () => {
    if (pending?.phase !== 'waiting-for-layout') return;
    if (options.scroll()) cancel();
  };

  const goToLatest = async () => {
    const request: Request = { phase: 'loading' };
    pending = request;
    try {
      const loading = options.loadLatest();
      if (loading) await loading;
      if (pending !== request) return;
      request.phase = 'waiting-for-layout';
      onLayout();
    } catch {
      // The messages query owns error presentation. A failed request must not
      // leave a navigation waiting to hijack an unrelated future page load.
      if (pending === request) cancel();
    }
  };

  return { goToLatest, onLayout, cancel };
}
