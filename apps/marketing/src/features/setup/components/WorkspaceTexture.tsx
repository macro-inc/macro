const textureMask =
  'radial-gradient(ellipse 50% 50% at center, black 0%, #0009 25%, #0003 45%, #00000008 60%, transparent 78%)';

/** Shared grain and accent dots for the opening onboarding slides. */
export function WorkspaceTexture(props: { accent: string; filterId: string }) {
  return (
    <>
      <div
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 opacity-20"
        style={{
          'background-image': `radial-gradient(${props.accent} .7px, transparent .7px)`,
          'background-size': '8px 8px',
          'mask-image': textureMask,
        }}
      />
      <svg
        data-workspace-texture
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 size-full"
        style={{ opacity: 0.2, 'mask-image': textureMask }}
      >
        <filter id={props.filterId}>
          <feTurbulence
            type="fractalNoise"
            baseFrequency=".025"
            numOctaves="4"
            stitchTiles="stitch"
          />
          <feColorMatrix type="saturate" values="0" />
        </filter>
        <rect
          width="100%"
          height="100%"
          filter={`url(#${props.filterId})`}
          opacity=".7"
        />
      </svg>
    </>
  );
}
