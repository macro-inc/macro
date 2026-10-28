import { makePersisted } from '@solid-primitives/storage';
import { createSignal } from 'solid-js';
import {
  type CrmDisplayOptions,
  DEFAULT_CRM_DISPLAY_OPTIONS,
} from './core/display-options';
import { createCrmDisplayOptions } from './primitives/display-options';

// One app preference keeps every mounted CRM surface in sync.
const [options, setOptions] = makePersisted(
  createSignal<CrmDisplayOptions>(DEFAULT_CRM_DISPLAY_OPTIONS),
  { name: 'macro:pref:crm:display' }
);
export const createAppCrmDisplayOptions = () =>
  createCrmDisplayOptions(options, setOptions);
