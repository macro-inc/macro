//! Device form-factor detection.
//!
//! `-[UIDevice userInterfaceIdiom]` is UIKit and must only be touched on the
//! main thread, but a sync `#[tauri::command]` is served off the IPC thread.
//! The idiom never changes at runtime, so it is sampled once at the top of
//! `run()` — which on iOS is `main()`'s thread, via `ffi::start_app()` in
//! `gen/apple/Sources/app/main.mm` — and stored as managed state. The command
//! only reads that snapshot.

/// Managed state: whether the device reports the iPad UI idiom.
///
/// Always `false` off iOS.
pub(crate) struct IsIpad(pub(crate) bool);

/// `UIUserInterfaceIdiomPad`, from `<UIKit/UIDevice.h>`.
#[cfg(target_os = "ios")]
const UI_USER_INTERFACE_IDIOM_PAD: objc2::ffi::NSInteger = 1;

/// Reads `[[UIDevice currentDevice] userInterfaceIdiom]`, excluding iOS apps
/// running on an Apple Silicon Mac (which also report the iPad idiom).
///
/// Must be called on the main thread — UIKit requirement.
///
/// This depends on `TARGETED_DEVICE_FAMILY` including `2` (see
/// `gen/apple/project.yml` and `project.pbxproj`). If the app were ever built
/// iPhone-only, it would run on iPad in compatibility mode and the idiom would
/// silently become `.phone`, making this return `false` with no compile error.
#[cfg(target_os = "ios")]
pub(crate) fn detect_is_ipad() -> bool {
    use objc2::ffi::NSInteger;
    use objc2::runtime::{AnyObject, Bool};
    use objc2::{class, msg_send};

    // SAFETY: `+[UIDevice currentDevice]`, `-[UIDevice userInterfaceIdiom]`,
    // `+[NSProcessInfo processInfo]` and `-[NSProcessInfo isiOSAppOnMac]` all
    // take no arguments and return `id`/`NSInteger`/`BOOL` respectively. Both
    // `currentDevice` and `processInfo` return unowned shared singletons, so
    // nothing needs releasing. Called on the main thread. Each nil check
    // precedes the message send that follows it because objc2 panics on
    // messaging nil in debug builds.
    unsafe {
        let device: *mut AnyObject = msg_send![class!(UIDevice), currentDevice];
        if device.is_null() {
            tracing::warn!("[UIDevice currentDevice] was nil; assuming non-iPad");
            return false;
        }

        let idiom: NSInteger = msg_send![device, userInterfaceIdiom];
        tracing::debug!(idiom, "UIDevice userInterfaceIdiom");
        if idiom != UI_USER_INTERFACE_IDIOM_PAD {
            return false;
        }

        // An unmodified iOS binary running on an Apple Silicon Mac ("Designed
        // for iPad") also reports the `.pad` idiom. Those users are not on an
        // iPad, so exclude them.
        let process: *mut AnyObject = msg_send![class!(NSProcessInfo), processInfo];
        if !process.is_null() {
            let is_ios_app_on_mac: Bool = msg_send![process, isiOSAppOnMac];
            if is_ios_app_on_mac.as_bool() {
                tracing::debug!("iPad idiom reported by an iOS app on macOS; treating as non-iPad");
                return false;
            }
        }

        true
    }
}

/// Non-iOS builds are never an iPad.
#[cfg(not(target_os = "ios"))]
pub(crate) fn detect_is_ipad() -> bool {
    false
}

/// Returns `true` when the app is running with the iPad UI idiom.
#[tauri::command]
pub(crate) fn is_ipad(state: tauri::State<'_, IsIpad>) -> bool {
    state.0
}
