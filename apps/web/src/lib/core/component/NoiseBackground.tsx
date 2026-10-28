/**
 * Marketing-hero backdrop: an ink/surface wash plus a film-grain tile.
 * Both layers are pointer-transparent; page content must sit at z-10,
 * between the wash (z-0) and the grain (z-20).
 */
export function NoiseBackground() {
  return (
    <>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(120% 90% at 50% 100%, color-mix(in srgb, var(--color-ink) 11%, var(--color-surface)) 0%, var(--color-surface) 75%)',
        }}
      />
      <div
        aria-hidden="true"
        style={`position:absolute;top:0;bottom:0;left:50%;transform:translateX(-50%);width:100vw;pointer-events:none;z-index:20;opacity:0.05;mix-blend-mode:screen;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.6' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");background-size:300px 300px;-webkit-mask:linear-gradient(to bottom, transparent 0%, #000 12%, #000 100%);mask:linear-gradient(to bottom, transparent 0%, #000 12%, #000 100%)`}
      />
    </>
  );
}
