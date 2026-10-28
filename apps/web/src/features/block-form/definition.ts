import { defineBlock, LoadErrors, loadResult } from '@core/block';
import { lazy } from 'solid-js';

export const definition = defineBlock({
  name: 'form',
  description: 'Build a form and collect responses',
  // Loaded lazily, only when a form opens. Cards in messages and the
  // respond view work for everyone the service lets in; the block itself
  // keeps the builder behind the flag.
  component: lazy(() => import('./form-block')),
  openTrackingEnabled: true,
  editPermissionEnabled: true,
  async load(source, _intent) {
    if (source.type !== 'dss') return LoadErrors.MISSING;
    const { loadForm } = await import('./queries/load-form');
    return await loadResult(loadForm(source.id));
  },
  accepted: {},
  defaultFilename: 'Untitled form',
});
