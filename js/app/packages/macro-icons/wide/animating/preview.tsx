export const AnimatedPreviewIcon = (props: { triggerAnimation?: boolean }) => {
  // Eye icon with pupil animation - pupil slides left and right

  return (
    <svg
      width="100%"
      height="100%"
      viewBox="0 0 24 24"
      fill="currentColor"
      stroke="none"
      xmlns="http://www.w3.org/2000/svg"
      overflow="visible"
      class={`animated-preview-icon ${props.triggerAnimation ? 'animating' : ''}`}
    >
      <title>Animated preview icon</title>
      <style>{`
        @keyframes pupil-look {
          0% { transform: translateX(0); animation-timing-function: ease-out; }
          15% { transform: translateX(-1.5px); animation-timing-function: linear; }
          35% { transform: translateX(-1.5px); animation-timing-function: ease-in-out; }
          50% { transform: translateX(0); animation-timing-function: ease-out; }
          65% { transform: translateX(1.5px); animation-timing-function: linear; }
          85% { transform: translateX(1.5px); animation-timing-function: ease-in; }
          100% { transform: translateX(0); }
        }

        .animated-preview-icon {
          .pupil { transform-origin: 12px 12px; }

          &.animating .pupil {
            animation: pupil-look 0.9s linear forwards;
          }
        }
      `}</style>

      {/* Eye outline - exact match from preview.svg */}
      <path d="M12 6C14.8251 6 17.0617 7.44762 18.5537 8.82422C19.3047 9.51721 19.8852 10.2084 20.2783 10.7266C20.4752 10.986 20.6264 11.2035 20.7295 11.3584C20.7811 11.4359 20.8212 11.4983 20.8486 11.542C20.8623 11.5638 20.8733 11.5813 20.8809 11.5938L20.8926 11.6133L20.8936 11.6152L20.25 12L20.8936 12.3848L20.8926 12.3867L20.8809 12.4062C20.8733 12.4187 20.8623 12.4362 20.8486 12.458C20.8212 12.5017 20.7811 12.5641 20.7295 12.6416C20.6264 12.7965 20.4752 13.014 20.2783 13.2734C19.8852 13.7916 19.3047 14.4828 18.5537 15.1758C17.0617 16.5524 14.8251 18 12 18C9.17491 18 6.93826 16.5524 5.44629 15.1758C4.69526 14.4828 4.11484 13.7916 3.72168 13.2734C3.52484 13.014 3.37365 12.7965 3.27051 12.6416C3.2189 12.5641 3.17884 12.5017 3.15137 12.458C3.13767 12.4362 3.12674 12.4187 3.11914 12.4062L3.10742 12.3867L3.10645 12.3848L3.75 12L3.10645 11.6152L3.10742 11.6133L3.11914 11.5938C3.12674 11.5813 3.13767 11.5638 3.15137 11.542C3.17884 11.4983 3.2189 11.4359 3.27051 11.3584C3.37365 11.2035 3.52484 10.986 3.72168 10.7266C4.11484 10.2084 4.69526 9.51721 5.44629 8.82422C6.93826 7.44762 9.17491 6 12 6ZM12 7.5C9.70529 7.5 7.81687 8.67751 6.46387 9.92578C5.79269 10.5451 5.27066 11.1667 4.91699 11.6328C4.81254 11.7705 4.72321 11.8946 4.64941 12C4.72321 12.1054 4.81254 12.2295 4.91699 12.3672C5.27066 12.8333 5.79269 13.4549 6.46387 14.0742C7.81687 15.3225 9.70529 16.5 12 16.5C14.2947 16.5 16.1831 15.3225 17.5361 14.0742C18.2073 13.4549 18.7293 12.8333 19.083 12.3672C19.1873 12.2297 19.2759 12.1053 19.3496 12C19.2759 11.8947 19.1873 11.7703 19.083 11.6328C18.7293 11.1667 18.2073 10.5451 17.5361 9.92578C16.1831 8.67751 14.2947 7.5 12 7.5ZM3.75 12L3.10547 12.3838L2.87695 12L3.10547 11.6162L3.75 12ZM21.123 12L20.8945 12.3838L20.25 12L20.8945 11.6162L21.123 12Z" />

      {/* Diamond pupil - animated (outer diamond with inner cutout) */}
      <path
        class="pupil"
        d="M15.1777 12.001L11.9961 15.1836L8.81445 12.001L11.9961 8.81934L15.1777 12.001ZM10.9355 12.001L11.9961 13.0615L13.0557 12.001L11.9961 10.9404L10.9355 12.001Z"
      />
    </svg>
  );
};
