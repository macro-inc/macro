export function ThemeColorSwatch(props: { width: string; color: string }) {
  return (
    <div
      style="
        transition: border-color var(--transition);
        border: 1px solid var(--b4);
        border-radius: 2px;
        padding: 3px;
      "
      class="theme-color-swatch"
    >
      <div
        style={{
          'background-color': props.color,
          'border-radius': '0.5px',
          width: props.width,
          height: '10px',
        }}
      />
    </div>
  );
}
