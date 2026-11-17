import type { BlockName } from '@core/block';

export const blocks = { email: { name: 'email', component: () => null } };
export const isBlockAlias = () => false;
export const resolveBlockAlias = (type: BlockName) => type;
export const fileTypeToBlockName = (type: BlockName) => type;
export const resolveComponent = () => ({ component: () => null });
export const BlockLoader = () => null;
export const BlockEffectRunner = () => null;
export const blockDataSignal = () => [() => undefined, () => undefined];
