// Renders Slack's reCAPTCHA v2 challenge over the current slack.com page and
// reports its state. Evaluated repeatedly from Rust: the first call on a loaded
// page installs the widget, and every call returns `{ status, token }` where
// status is loading, pending, solved, or failed.
(config) => {
  if (document.readyState !== 'complete')
    return { status: 'loading', token: null };

  const existing = window.__macroSlackCaptcha;
  if (existing) return { status: existing.status, token: existing.token };

  const state = { status: 'pending', token: null };
  window.__macroSlackCaptcha = state;

  window.__macroSlackCaptchaLoaded = () => {
    const overlay = document.createElement('div');
    // Google's reCAPTCHA challenge popup uses z-index 2000000000.
    overlay.style.cssText =
      'position:fixed;inset:0;z-index:1999999999;background:#fff;' +
      'display:flex;align-items:center;justify-content:center;padding:2rem';

    const content = document.createElement('div');
    content.style.cssText =
      'display:flex;flex-direction:column;gap:1rem;align-items:center;' +
      'text-align:center;font:16px sans-serif;color:#1d1c1d';

    const heading = document.createElement('strong');
    heading.textContent = 'Complete the Slack verification';
    const challenge = document.createElement('div');
    content.append(heading, challenge);
    overlay.append(content);
    document.body.append(overlay);

    // A failed or expired challenge resets so the person can try again;
    // closing the window is how they give up.
    const widget = grecaptcha.render(challenge, {
      sitekey: config.siteKey,
      callback: (token) => {
        state.token = token;
        state.status = 'solved';
      },
      'error-callback': () => grecaptcha.reset(widget),
      'expired-callback': () => grecaptcha.reset(widget),
    });
  };

  const script = document.createElement('script');
  script.src =
    'https://www.google.com/recaptcha/api.js?render=explicit&onload=__macroSlackCaptchaLoaded';
  script.async = true;
  script.onerror = () => {
    state.status = 'failed';
  };
  document.head.append(script);

  return { status: state.status, token: state.token };
};
