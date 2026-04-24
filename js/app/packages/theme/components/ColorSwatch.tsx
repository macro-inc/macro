export function ColorSwatch(props: { width: string; color: string }) {
  return (
    <div
      class="theme-color-swatch"
      style="
        transition: border-color var(--transition);
        border: 1px solid var(--color-edge-muted);
        border-radius: 2px;
        padding: 3px;
      "
    >
      <div
        style={{
          'background-color': props.color,
          'border-radius': '1px',
          width: props.width,
          height: '10px',
        }}
      />
    </div>
  );
}
