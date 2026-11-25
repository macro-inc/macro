/**
 * The lab's one registered challenge location. The runner opens nothing else,
 * and the server answers only on this origin.
 */
export const LAB_HOST = '127.0.0.1';
export const LAB_PORT = 47831;
export const LAB_ORIGIN = `http://${LAB_HOST}:${LAB_PORT}`;
export const LAB_PATH = '/lab/shapes-quiz';
export const LAB_URL = `${LAB_ORIGIN}${LAB_PATH}`;
export const LAB_SUBMIT_PATH = '/lab/api/submit';
export const LAB_ASSET_PATH_PREFIX = '/lab/asset/';

/** Header carrying the one-time run capability, on the page request only. */
export const CAPABILITY_HEADER = 'x-lab-capability';
/** Header carrying the browser-session nonce, on every lab request. */
export const SESSION_HEADER = 'x-lab-session';

/** The model id #11637's solver uses on Fireworks. */
export const KIMI_MODEL = 'accounts/fireworks/models/kimi-k3';
export const FIREWORKS_BASE_URL = 'https://api.fireworks.ai/inference/v1';
