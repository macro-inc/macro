import { demoHref, handleDemoClick } from '../../utils/utilCta';

/**
 * Quiet "Book a live demo →" text link for phones, shown under the email
 * capture form where desktop shows the "Book demo" pill. Same cal.com
 * destination and `demo_booking_open` tracking as the desktop button.
 */
export function LinkBookDemo(props: { buttonName: string }) {
  return (
    <>
      <style>{`
        @media (hover) {
          .link-book-demo:hover { color: var(--c1); }
        }
        .link-book-demo:active { color: var(--c1); }
      `}</style>
      <a
        href={demoHref()}
        class="link-book-demo"
        target="_blank"
        rel="noopener noreferrer"
        onClick={() => handleDemoClick(props.buttonName)}
        style={{
          color: 'color-mix(in srgb, var(--c4) 72%, transparent)',
          'font-family': 'body',
          'font-size': '14px',
          'font-weight': '500',
          'letter-spacing': '0.01em',
          'line-height': 1.4,
          // Vertical padding gives the slim text a ~44px thumb target.
          padding: '10px 0',
          'text-decoration': 'none',
          transition: 'color 160ms ease',
          'white-space': 'nowrap',
        }}
      >
        Book a live demo &rarr;
      </a>
    </>
  );
}
