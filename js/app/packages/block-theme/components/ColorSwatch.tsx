export function ColorSwatch(props: { width: string; color: string }) {
  return (
    <div
      class="theme-color-swatch"
      style="
        transition: border-color var(--transition);
        border: 1px solid var(--b4);
        padding: 3px;
      "
    >
      <div
        style={{
          'background-color': props.color,
          width: props.width,
          height: '10px',
        }}
      />
    </div>
  );
}
