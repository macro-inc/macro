# Custom Cursor

## Adding Cursor styling

If you adding cursor styling, as long as you use tailwind cursor variant, such as `cursor-pointer`, or inline style, the custom cursor logic will automatically determine cursor property.

But if you're adding an arbritrary class with cursor property, make sure to add custom cursor variable inside that declaration.

```css
.pointer-on-img {
  /* keep native as fallback when custom cursor is disabled */
  cursor: pointer;
  /* add custom cursor variable */
  --custom-cursor: pointer;
}
```
