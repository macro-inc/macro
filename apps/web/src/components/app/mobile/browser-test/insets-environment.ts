// Evaluated before the app modules: `?native=ios` makes the fixture take the
// iOS app's keyboard path (keyboard bridge events) instead of Safari's.
const native = new URLSearchParams(location.search).get('native');
if (native === 'ios') {
  Object.assign(window, {
    __TAURI_INTERNALS__: { metadata: {}, invoke: () => Promise.resolve() },
    __TAURI_OS_PLUGIN_INTERNALS__: { os_type: 'ios' },
  });
}
document.documentElement.dataset.touchDevice = 'true';
