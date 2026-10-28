import type { Accessor } from 'solid-js';
import { MacroMarkIcon } from '../graphics/MacroMarkIcon';

// The small brand tag that sits above each hero headline — the Macro mark
// followed by the product name in a spaced, uppercase Inter cap. Shared by
// the home hero and every feature page so the label reads identically across
// the site (only the `label` text changes per page).
export function HeroEyebrow(props: {
  label: string;
  mobile: Accessor<boolean>;
}) {
  return (
    <span
      style={{
        'align-items': 'center',
        color: 'var(--a0)',
        display: 'inline-flex',
        'font-family': 'Inter, body',
        'font-size': props.mobile() ? '11px' : '12px',
        gap: props.mobile() ? '7px' : '9px',
        'font-weight': '500',
        'letter-spacing': '0.1em',
        'text-transform': 'uppercase',
      }}
    >
      <MacroMarkIcon
        style={{
          color: 'var(--a0)',
          display: 'block',
          fill: 'currentColor',
          flex: 'none',
          height: props.mobile() ? '11px' : '13px',
          overflow: 'visible',
          stroke: 'none',
        }}
      />
      {props.label}
    </span>
  );
}
