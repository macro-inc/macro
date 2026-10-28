// A date/section divider for the app-preview list windows (email, calls): an
// uppercase label with a faint hairline running right from its centre. Shared so
// every list window's dividers stay consistent.
const appFont =
  "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

export function PreviewListDivider(props: {
  label: string;
  compact?: boolean;
}) {
  return (
    <div
      style={{
        'align-items': 'center',
        display: 'flex',
        gap: '10px',
        padding: props.compact ? '6px 13px' : '6px 16px',
      }}
    >
      <span
        style={{
          color: 'var(--c4)',
          'font-family': appFont,
          'font-size': '10px',
          'font-weight': '500',
          'letter-spacing': '0.05em',
          'text-transform': 'uppercase',
          'white-space': 'nowrap',
        }}
      >
        {props.label}
      </span>
      {/* Hairline that runs right from the label's centre, as faint as the
          mockup's edge borders. */}
      <span
        aria-hidden="true"
        style={{
          'background-color': 'color-mix(in srgb, var(--b4) 12%, transparent)',
          flex: '1 1 0',
          height: '1px',
        }}
      />
    </div>
  );
}
