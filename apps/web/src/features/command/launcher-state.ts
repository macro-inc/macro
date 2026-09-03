import { createControlledOpenSignal } from '@core/util/createControlledOpenSignal';

export const [createMenuOpen, setCreateMenuOpen] = createControlledOpenSignal(
  false,
  { id: 'launcher' }
);
