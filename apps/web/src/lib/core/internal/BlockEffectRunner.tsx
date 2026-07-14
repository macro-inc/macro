import { globalBlockEffects, globalBlockRenderEffects } from '@core/block';
import { blockContainerMountedSignal } from '@core/signal/blockElement';
import { createComputed, createEffect } from 'solid-js';
import { blockDataSignal } from './BlockLoader';

export function BlockEffectRunner() {
  createComputed(() => {
    if (!blockDataSignal() || !blockContainerMountedSignal()) return;

    for (let i = 0; i < globalBlockRenderEffects().length; i++) {
      createEffect(globalBlockRenderEffects()[i]);
    }

    for (let i = 0; i < globalBlockEffects().length; i++) {
      createEffect(globalBlockEffects()[i]);
    }
  });

  return '';
}
