/** A late-loading document may claim focus only while its own shell still owns it. */
export function shouldAutofocusDocument(
  block: HTMLElement | null,
  panel: HTMLElement | null
) {
  const active = document.activeElement;
  return (
    active === document.body ||
    active === document.documentElement ||
    active === block ||
    active === panel
  );
}
