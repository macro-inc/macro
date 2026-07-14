export function attributesToSelector(el: HTMLElement) {
  if (!el || !el.attributes) return '';

  const parts = [];

  for (let attr of el.attributes) {
    if (attr.name === 'class') {
      // Add each class as a CSS class selector
      const classes = attr.value.trim().split(/\s+/);
      classes.forEach((cls) => {
        // Escape brackets (e.g., Tailwind classes)
        const escaped = CSS.escape(cls);
        parts.push(`.${escaped}`);
      });
    } else if (attr.name === 'id') {
      // Escape ID
      parts.push(`#${CSS.escape(attr.value)}`);
    } else {
      // Handle all other attributes
      const escapedName = CSS.escape(attr.name);
      const escapedValue = CSS.escape(attr.value);
      parts.push(`[${escapedName}="${escapedValue}"]`);
    }
  }

  return parts.join('');
}
