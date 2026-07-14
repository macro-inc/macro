import { isTauri } from '@core/util/platform';

export const ROUTER_BASE = isTauri() ? '/' : '/app';

export const ROUTER_BASE_CONCAT = isTauri() ? '/' : '/app/';
