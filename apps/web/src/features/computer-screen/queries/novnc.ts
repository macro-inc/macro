import type { ConnectScreen } from '../context/screen-context';

export const connectScreen: ConnectScreen = async (
  target,
  url,
  control,
  events
) => {
  const { default: RFB } = await import('@novnc/novnc');
  const rfb = new RFB(target, url);
  rfb.viewOnly = !control;
  rfb.focusOnClick = control;
  rfb.scaleViewport = true;
  rfb.resizeSession = false;
  rfb.addEventListener('connect', () => {
    if (control) {
      const canvas = target.querySelector('canvas');
      if (canvas) {
        canvas.tabIndex = 0;
        canvas.setAttribute('data-keyboard-input', '');
      }
      rfb.focus({ preventScroll: true });
    }
    events.connected();
  });
  rfb.addEventListener('disconnect', events.disconnected);
  rfb.addEventListener('securityfailure', events.disconnected);
  return { disconnect: () => rfb.disconnect() };
};
