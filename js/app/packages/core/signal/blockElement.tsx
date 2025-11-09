import { createBlockSignal } from '@core/block';

export const blockElementSignal = createBlockSignal<HTMLElement>();
export const blockContainerMountedSignal = createBlockSignal<boolean>(false);

export const blockHotkeyScopeSignal = createBlockSignal<string>('');
