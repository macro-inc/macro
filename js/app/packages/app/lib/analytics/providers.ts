import { createAnalyticsProvider } from './analytics';

export const googleAnalyticsProvider = createAnalyticsProvider({
  id: 'google-analytics',
  initialize() {
    // Google Analytics
    const gaScript = document.createElement('script');
    gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-52HPEL3FTV';
    gaScript.async = true;
    document.head.appendChild(gaScript);

    const gaInit = document.createElement('script');
    gaInit.innerHTML = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-52HPEL3FTV');
  `;
    document.head.appendChild(gaInit);

    // Google Tag Manager
    const gtmScript = document.createElement('script');
    gtmScript.innerHTML = `
    (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
    new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
    j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
    'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
    })(window,document,'script','dataLayer','GTM-M58X7PJ8');
  `;
    document.head.appendChild(gtmScript);
  },
  track(event, data) {
    gtag('event', event, data);
  },
});

export const metaPixelProvider = createAnalyticsProvider({
  id: 'meta-pixel',
  initialize() {},
  track(event, data) {},
});
