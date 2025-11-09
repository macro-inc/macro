import { setAppVersion, setIsNightly, setSegmentWriteKey } from './segment';

const addGoogleAnalytics = () => {
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
};

export function init({
  appVersion,
  segmentWriteKey,
  mode,
}: {
  appVersion: string;
  segmentWriteKey: string;
  mode: ImportMetaEnv['MODE'];
}) {
  setAppVersion(appVersion);
  setSegmentWriteKey(segmentWriteKey);
  setIsNightly(mode === 'development' ? 'true' : 'false');

  if (mode !== 'production') return;

  addGoogleAnalytics();
  console.log('Google Analytics initialized');

  import('react-facebook-pixel').then(({ default: ReactPixel }) => {
    console.log('ReactPixel imported');
    ReactPixel.init('639142540393286', undefined, {
      autoConfig: true,
      debug: false,
    });
    ReactPixel.pageView();
    console.log('ReactPixel initialized');
  });
}
