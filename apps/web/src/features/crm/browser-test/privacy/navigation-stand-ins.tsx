import type { BlockName } from '@core/block';
import { createSignal } from 'solid-js';

export const blocks = { email: { name: 'email', component: () => null } };
export const isBlockAlias = () => false;
export const resolveBlockAlias = (type: BlockName) => type;
export const fileTypeToBlockName = (type: BlockName) => type;
export const resolveComponent = () => ({ component: () => null });
export const BlockLoader = () => null;
export const BlockEffectRunner = () => null;
const [data, setData] = createSignal<unknown>();
const [liveTrackingEnabled, setLiveTrackingEnabled] = createSignal<boolean>();
export const blockDataSignal = Object.assign(data, {
  get: data,
  set: setData,
});
export const blockLiveTrackingEnabledSignal = Object.assign(
  liveTrackingEnabled,
  { get: liveTrackingEnabled, set: setLiveTrackingEnabled }
);
