export const getUtmParams = (): Record<string, string> => {
  // Helper to parse document.cookie string into an object.
  const parseCookies = (cookieString: string): Record<string, string> =>
    cookieString.split('; ').reduce(
      (acc, cookie) => {
        // Use the first '=' as the separator.
        const separatorIndex = cookie.indexOf('=');
        if (separatorIndex === -1) return acc;
        const key = cookie.substring(0, separatorIndex);
        const value = cookie.substring(separatorIndex + 1);
        acc[key] = value;
        return acc;
      },
      {} as Record<string, string>
    );

  let cookies: Record<string, string> = {};
  try {
    cookies = parseCookies(document.cookie);
  } catch (error) {
    console.error('Error parsing cookies:', error);
    return {};
  }

  const marketingKeys = [
    'rdt_cid',
    'gclid',
    'twclid',
    'utm_source',
    'utm_medium',
    'utm_campaign',
    'utm_term',
    'utm_content',
    '_fbc',
    '_fbp',
  ];

  const utmObj: Record<string, string> = {};
  marketingKeys.forEach((key) => {
    if (key in cookies && cookies[key]) {
      utmObj[key] = cookies[key];
    }
  });

  return utmObj;
};
