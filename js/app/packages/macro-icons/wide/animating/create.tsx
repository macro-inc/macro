export const AnimatedCreateIcon = (props: { triggerAnimation?: boolean }) => {
  // Pixel positions at arm tips (matching Asset 171.svg layout):
  // Top: (8.25, 0), Right: (16.5, 5.25), Bottom: (8.25, 10.5), Left: (0, 5.25)
  //
  // Animation: each pixel slides out of its arm, moves clockwise to next arm,
  // and slides into that arm's tip slot. End state looks same as start.

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 -3 18 18"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-create-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      <title>Animated create icon</title>
      <style>{`
        /*
         * Clockwise rotation: Top→Right→Bottom→Left→Top
         * Each pixel: slides out of arm → moves to next arm → slides in
         * Total displacement: dx=±8.25, dy=±5.25 between adjacent arm tips
         */

        /* Top pixel (8.25, 0) → Right position (16.5, 5.25) */
        @keyframes top-to-right {
          0% { transform: translate(0, 0); }
          30% { transform: translate(0, -2px); }
          70% { transform: translate(8.25px, -2px); }
          100% { transform: translate(8.25px, 5.25px); }
        }

        /* Right pixel (16.5, 5.25) → Bottom position (8.25, 10.5) */
        @keyframes right-to-bottom {
          0% { transform: translate(0, 0); }
          30% { transform: translate(2px, 0); }
          70% { transform: translate(2px, 5.25px); }
          100% { transform: translate(-8.25px, 5.25px); }
        }

        /* Bottom pixel (8.25, 10.5) → Left position (0, 5.25) */
        @keyframes bottom-to-left {
          0% { transform: translate(0, 0); }
          30% { transform: translate(0, 2px); }
          70% { transform: translate(-8.25px, 2px); }
          100% { transform: translate(-8.25px, -5.25px); }
        }

        /* Left pixel (0, 5.25) → Top position (8.25, 0) */
        @keyframes left-to-top {
          0% { transform: translate(0, 0); }
          30% { transform: translate(-2px, 0); }
          70% { transform: translate(-2px, -5.25px); }
          100% { transform: translate(8.25px, -5.25px); }
        }

        .animated-create-icon.animating .pixel-top {
          animation: top-to-right 0.6s ease-in-out forwards;
        }
        .animated-create-icon.animating .pixel-right {
          animation: right-to-bottom 0.6s ease-in-out forwards;
        }
        .animated-create-icon.animating .pixel-bottom {
          animation: bottom-to-left 0.6s ease-in-out forwards;
        }
        .animated-create-icon.animating .pixel-left {
          animation: left-to-top 0.6s ease-in-out forwards;
        }
      `}</style>

      {/* Main plus body - center cross without tip pixels */}
      {/* Vertical bar */}
      <rect x="8.25" y="1.5" width="1.5" height="9" />

      {/* Horizontal bar - left and right segments */}
      <rect x="1.5" y="5.25" width="6.75" height="1.5" />
      <rect x="9.75" y="5.25" width="6.75" height="1.5" />

      {/* Movable pixels at arm tips */}
      {/* Top pixel */}
      <rect class="pixel-top" x="8.25" y="0" width="1.5" height="1.5" />

      {/* Right pixel */}
      <rect class="pixel-right" x="16.5" y="5.25" width="1.5" height="1.5" />

      {/* Bottom pixel */}
      <rect class="pixel-bottom" x="8.25" y="10.5" width="1.5" height="1.5" />

      {/* Left pixel */}
      <rect class="pixel-left" x="0" y="5.25" width="1.5" height="1.5" />
    </svg>
  );
};
