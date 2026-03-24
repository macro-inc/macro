export const initializeGoogleAnalytics = () => {
  const G_ID = 'G-52HPEL3FTV';

  // Google Analytics
  const gaScript = document.createElement('script');
  gaScript.src = `https://www.googletagmanager.com/gtag/js?id=${G_ID}`;
  gaScript.async = true;
  document.head.appendChild(gaScript);

  const gaInit = document.createElement('script');
  gaInit.innerHTML = `
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', '${G_ID}', { send_page_view: false });
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

export const initializeMetaPixel = () => {
  const PIXEL_ID = '639142540393286';

  const fbqInit = document.createElement('script');
  fbqInit.innerHTML = `
     !function(f,b,e,v,n,t,s)
      {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
      n.callMethod.apply(n,arguments):n.queue.push(arguments)};
      if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
      n.queue=[];t=b.createElement(e);t.async=!0;
      t.src=v;s=b.getElementsByTagName(e)[0];
      s.parentNode.insertBefore(t,s)}(window, document,'script',
      'https://connect.facebook.net/en_US/fbevents.js');
      fbq.disablePushState = true;
      fbq('init', '${PIXEL_ID}');
    `;

  document.head.appendChild(fbqInit);

  const pixelImage = document.createElement('img');

  pixelImage.width = 1;
  pixelImage.height = 1;
  pixelImage.src = `https://www.facebook.com/tr?id=${PIXEL_ID}&ev=ViewContent&cd[content_name]=App%20NoScript&ev=PageView&noscript=1`;
  pixelImage.style.display = 'none';

  const pixelImageInit = document.createElement('noscript');
  pixelImageInit.append(pixelImage);

  document.head.appendChild(pixelImageInit);
};
