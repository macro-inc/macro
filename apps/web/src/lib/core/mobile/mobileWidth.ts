import { createSignal } from 'solid-js';

function readMobileWidth() {
  if (typeof window === 'undefined') return false;
  const sizeClass = document.documentElement.dataset.nativeHorizontalSizeClass;
  if (sizeClass) return sizeClass === 'compact';
  return window.innerWidth < 640;
}

const [isMobileWidth, setIsMobileWidth] = createSignal(readMobileWidth());

if (typeof window !== 'undefined') {
  const handleResize = () => {
    setIsMobileWidth(readMobileWidth());
  };

  window.addEventListener('resize', handleResize);
  new MutationObserver(handleResize).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-native-horizontal-size-class'],
  });
}

export { isMobileWidth };
