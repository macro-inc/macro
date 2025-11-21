# Custom Cursor

## ATTENTION use Tailind cursor-\* variant or css variable --cursor-\*

Using default tailwind cursor variant, such as `cursor-pointer`, works because it is overriden by the vite plugin that replaces value to use custom cursor css variable.

Otherwise use custom cursor variable `--cursor-<value-of-cursor>`, instead of default value.

```css
.pointer-on-img {
  cursor: pointer /* <--- DONT DO THIS otherwise it will show default cursor instead of custom */

  /* replace with custom cursor variable, variable uses native value as fallback */
  cursor: var(--cursor-pointer);
}
```

```html
<div style="cursor: var(--cursor-not-allowed)"></div>
```
