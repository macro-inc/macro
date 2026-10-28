//! Modules compiled only into the desktop app.
//!
//! Everything under `src/desktop/` is `cfg(desktop)` by construction — the
//! whole tree hangs off one gated `mod desktop;` in lib.rs — which is what
//! lets the Android and iOS native-release gates exempt this path by name:
//! changes here can never reach a mobile binary, so they require no mobile
//! version bump or store release (see apps/web/scripts/android-native.mjs and
//! tooling/xtask/.../scripts/ios_native_tree.sh).

pub(crate) mod macrod;
