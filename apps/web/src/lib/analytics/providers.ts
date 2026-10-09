import { GOOGLE_ADS_ID } from '@app/lib/analytics/googleConversions';

const AD_CLICK_PARAMS = ['gclid', 'gbraid', 'wbraid', 'dclid', 'fbclid'];

function hasAdClickId(): boolean {
  const search = new URLSearchParams(window.location.search);
  return AD_CLICK_PARAMS.some((param) => search.has(param));
}

/**
 * Marketing tags cost more main-thread time than the app's own entry, so their
 * libraries wait until startup settles. The inline `gtag`/`fbq` stubs queue
 * calls until then. Ad landings load at once so the tags read the click ID
 * from the landing URL.
 */
function loadScriptAfterStartup(src: string): void {
  const append = () => {
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    document.head.appendChild(script);
  };
  if (hasAdClickId()) {
    append();
    return;
  }

  const whenIdle = () => {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(append, { timeout: 5000 });
    } else {
      setTimeout(append, 2000);
    }
  };
  if (document.readyState === 'complete') whenIdle();
  else window.addEventListener('load', whenIdle, { once: true });
}

export const initializeGoogleAnalytics = () => {
  const G_ID = 'G-52HPEL3FTV';

  // Google Analytics
  loadScriptAfterStartup(`https://www.googletagmanager.com/gtag/js?id=${G_ID}`);

  // Registering the AW account on page load is what lets gtag pick up
  // ?gclid=… from the URL into the _gcl_aw cookie, so subsequent
  // gtag('event', 'conversion', ...) fires can be attributed to the ad click.
  const gaInit = document.createElement('script');
  gaInit.innerHTML = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${G_ID}', { send_page_view: false });
    gtag('config', '${GOOGLE_ADS_ID}');
  `;
  document.head.appendChild(gaInit);

  // Google Tag Manager
  const gtmScript = document.createElement('script');
  gtmScript.innerHTML = `
    window.dataLayer = window.dataLayer || [];
    dataLayer.push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
  `;
  document.head.appendChild(gtmScript);
  loadScriptAfterStartup(
    'https://www.googletagmanager.com/gtm.js?id=GTM-M58X7PJ8'
  );
};

export const initializeMetaPixel = () => {
  const PIXEL_ID = '639142540393286';

  const fbqInit = document.createElement('script');
  fbqInit.innerHTML = `
     !function(f,n)
      {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[]}(window);
      fbq.disablePushState = true;
      fbq('init', '${PIXEL_ID}');
    `;

  document.head.appendChild(fbqInit);
  loadScriptAfterStartup('https://connect.facebook.net/en_US/fbevents.js');

  const pixelImage = document.createElement('img');

  pixelImage.width = 1;
  pixelImage.height = 1;
  pixelImage.src = `https://www.facebook.com/tr?id=${PIXEL_ID}&ev=ViewContent&cd[content_name]=App%20NoScript&ev=PageView&noscript=1`;
  pixelImage.style.display = 'none';

  const pixelImageInit = document.createElement('noscript');
  pixelImageInit.append(pixelImage);

  document.head.appendChild(pixelImageInit);
};
