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
  rfb.scaleViewport = true;
  rfb.resizeSession = false;
  rfb.addEventListener('connect', events.connected);
  rfb.addEventListener('disconnect', events.disconnected);
  rfb.addEventListener('securityfailure', events.disconnected);
  return { disconnect: () => rfb.disconnect() };
};
