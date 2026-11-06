import type { ConnectScreen } from '../../context/screen-context';
import { setConnections } from './scenario';

export async function resolveScreenUrl(id: string, control: boolean) {
  return `wss://fixture.invalid/${id}?control=${control}`;
}

export const connectScreen: ConnectScreen = async (
  target,
  _url,
  control,
  events
) => {
  setConnections((previous) => [...previous, control ? 'control' : 'watch']);
  const desktop = document.createElement('div');
  desktop.textContent = control
    ? 'Simulated desktop · control'
    : 'Simulated desktop · watch';
  desktop.className = 'grid size-full place-items-center bg-inset text-ink';
  target.append(desktop);
  events.connected();
  return { disconnect: () => desktop.remove() };
};
