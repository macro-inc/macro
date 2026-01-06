export function isInteractiveElement(el: Element | null): boolean {
  if (!el) return false;

  // 1. Custom flags (your existing logic)
  if ((el as any).$$click || (el as any).$$keydown) return true;

  const tag = el.tagName.toLowerCase();

  // 2. Native interactive HTML elements
  const nativeInteractive = [
    'button',
    'input',
    'select',
    'textarea',
    'option',
    'summary',
    'details',
  ];
  if (nativeInteractive.includes(tag)) return true;

  // <a href="...">
  if (tag === 'a' && (el as HTMLAnchorElement).href) return true;

  // 3. contenteditable
  if ((el as HTMLElement).isContentEditable) return true;

  // 4. Tabindex-able elements (keyboard focusable)
  const tabIndex = (el as HTMLElement).tabIndex;
  if (tabIndex >= 0) return true;

  // 5. ARIA interactive roles
  const ariaRole = el.getAttribute('role');
  const interactiveRoles = new Set([
    'button',
    'link',
    'checkbox',
    'menuitem',
    'option',
    'radio',
    'slider',
    'spinbutton',
    'switch',
    'textbox',
    'combobox',
    'tab',
  ]);
  if (ariaRole && interactiveRoles.has(ariaRole)) return true;

  return false;
}
