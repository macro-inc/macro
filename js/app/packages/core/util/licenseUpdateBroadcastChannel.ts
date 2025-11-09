const licenseUpdateChannel = new BroadcastChannel('license-update');

/**
 * utility interface for sending license update events across browser tabs without need to ipc (more direct)
 */
export const licenseChannel = {
  subscribe: (handler: () => void) => {
    licenseUpdateChannel.addEventListener('message', handler);
    return () => licenseUpdateChannel.removeEventListener('message', handler);
  },
  post: () => {
    licenseUpdateChannel.postMessage('license updated');
  },
};
