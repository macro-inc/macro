import { createSignal } from 'solid-js';

const [isMobileWidth, setIsMobileWidth] = createSignal(
  typeof window !== 'undefined' && window.innerWidth < 640
);

if (typeof window !== 'undefined') {
  const handleResize = () => {
    setIsMobileWidth(window.innerWidth < 640);
  };

  setIsMobileWidth(window.innerWidth < 640);

  window.addEventListener('resize', handleResize);
}

export { isMobileWidth };
