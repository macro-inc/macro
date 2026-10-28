import { viewportWidth } from '../../utils/utilBreakpoint';
import { EmailFeatureFiguresLarge } from './EmailFeatureFiguresLarge';

// A single row of email fundamentals on /email (3 large Blender figs). The
// homepage email block keeps the smaller 1×4 IsoLineArt set in EmailFeatureFigures.
export function EmailFeatureGrid() {
  const mobile = () => viewportWidth() < 700;

  return (
    <section
      aria-label="Why Macro Mail"
      style={{
        'box-sizing': 'border-box',
        display: 'grid',
        'justify-items': 'center',
        'padding-block': mobile() ? '56px' : '80px',
        'padding-inline': mobile() ? '18px' : '24px',
        width: '100%',
      }}
    >
      <div style={{ 'max-width': '1160px', width: '100%' }}>
        <EmailFeatureFiguresLarge />
      </div>
    </section>
  );
}
