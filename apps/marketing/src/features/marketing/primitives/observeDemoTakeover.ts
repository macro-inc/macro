/** Listen through nested preview boundaries without treating page scrolling as input. */
export function observeDemoTakeover(root: HTMLElement, takeOver: () => void) {
  const scopes: Element[] = [root];
  for (let node = root.parentElement; node; node = node.parentElement)
    if (node.matches('.demo-interaction-boundary')) scopes.push(node);
  const input = (event: Event) => {
    if (event.isTrusted) takeOver();
  };
  for (const scope of scopes)
    scope.addEventListener('macro-demo-interaction', takeOver);
  for (const event of ['pointerdown', 'keydown', 'input'])
    root.addEventListener(event, input, true);
  if (
    scopes.some(
      (scope) => scope.getAttribute('data-demo-interacted') === 'true'
    )
  )
    takeOver();
  return () => {
    for (const scope of scopes)
      scope.removeEventListener('macro-demo-interaction', takeOver);
    for (const event of ['pointerdown', 'keydown', 'input'])
      root.removeEventListener(event, input, true);
  };
}
