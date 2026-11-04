//! Screen sharing for the macOS Chromium build.
//!
//! CEF hosts the app as an Alloy style browser, which has no desktop media
//! picker and refuses `getDisplayMedia()`. The frontend shows its own picker
//! over [`list_screen_capture_sources`], arms a one-shot grant with
//! [`allow_screen_capture`], and requests the chosen source through
//! `getUserMedia()` with `chromeMediaSource: 'desktop'`. The runtime's desktop
//! capture hook calls [`take_screen_capture_grant`], so a page cannot capture
//! the screen unless the user just picked a source.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_core_foundation::CFString;
use objc2_core_graphics::{
    CGDirectDisplayID, CGDisplayIsBuiltin, CGError, CGGetActiveDisplayList, CGMainDisplayID,
    CGPreflightScreenCaptureAccess, CGRequestScreenCaptureAccess, CGWindowListCopyWindowInfo,
    CGWindowListOption, kCGNullWindowID, kCGWindowLayer, kCGWindowName, kCGWindowNumber,
    kCGWindowOwnerName, kCGWindowOwnerPID,
};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};
use serde::Serialize;

/// How long a pick stays valid while the frontend opens the capture stream.
const GRANT_TTL: Duration = Duration::from_secs(10);

const MAX_DISPLAYS: u32 = 16;

static GRANT_EXPIRES_AT: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ScreenCaptureSourceKind {
    Screen,
    Window,
}

/// A screen or window the user can share.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureSource {
    /// Chromium's `DesktopMediaID` string, passed as `chromeMediaSourceId`.
    pub id: String,
    pub kind: ScreenCaptureSourceKind,
    /// The window title, when macOS exposes it. Screens have none; the
    /// frontend labels them.
    pub name: Option<String>,
    /// The owning application, for windows.
    pub app_name: Option<String>,
    /// Whether a screen is the built-in display.
    pub builtin: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScreenCaptureSources {
    /// Whether macOS Screen Recording access is granted. Without it, capture
    /// fails and window titles are hidden.
    pub has_access: bool,
    pub sources: Vec<ScreenCaptureSource>,
}

/// Lists the displays and on-screen windows, displays first.
#[tauri::command]
pub fn list_screen_capture_sources() -> ScreenCaptureSources {
    let has_access = CGPreflightScreenCaptureAccess();
    let mut sources = displays();
    sources.extend(windows());
    ScreenCaptureSources {
        has_access,
        sources,
    }
}

/// Shows the macOS Screen Recording prompt the first time; afterwards macOS
/// only reports the stored answer. Returns whether access is granted.
#[tauri::command]
pub fn request_screen_capture_access() -> bool {
    CGRequestScreenCaptureAccess()
}

/// Arms a single desktop capture grant for the source the user just picked.
#[tauri::command]
pub fn allow_screen_capture() {
    *lock_grant() = Some(Instant::now() + GRANT_TTL);
}

/// Consumes the armed grant. Called by the CEF desktop capture hook on its UI
/// thread for every desktop capture request.
pub fn take_screen_capture_grant() -> bool {
    lock_grant()
        .take()
        .is_some_and(|expires_at| Instant::now() < expires_at)
}

fn lock_grant() -> std::sync::MutexGuard<'static, Option<Instant>> {
    // The guarded value is a plain deadline, so a poisoned lock is still usable.
    GRANT_EXPIRES_AT
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

fn displays() -> Vec<ScreenCaptureSource> {
    let mut ids: [CGDirectDisplayID; MAX_DISPLAYS as usize] = [0; MAX_DISPLAYS as usize];
    let mut count = 0u32;
    // SAFETY: `ids` holds `MAX_DISPLAYS` entries and `count` is a valid out pointer.
    let error = unsafe { CGGetActiveDisplayList(MAX_DISPLAYS, ids.as_mut_ptr(), &raw mut count) };
    if error != CGError::Success {
        tracing::warn!(error = error.0, "failed to list displays");
        return Vec::new();
    }

    let main = CGMainDisplayID();
    let mut ids = ids[..count as usize].to_vec();
    // The main display first, so it is the default choice.
    ids.sort_by_key(|id| *id != main);
    ids.into_iter()
        .map(|id| ScreenCaptureSource {
            id: format!("screen:{id}:0"),
            kind: ScreenCaptureSourceKind::Screen,
            name: None,
            app_name: None,
            builtin: CGDisplayIsBuiltin(id),
        })
        .collect()
}

fn windows() -> Vec<ScreenCaptureSource> {
    let options =
        CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements;
    let Some(info) = CGWindowListCopyWindowInfo(options, kCGNullWindowID) else {
        return Vec::new();
    };
    // SAFETY: CFArray is toll-free bridged to NSArray, and every element of the
    // window list is a CFDictionary keyed by CFString.
    let info: &NSArray<NSDictionary<NSString, AnyObject>> = unsafe { &*(&raw const *info).cast() };

    let own_pid = i64::from(std::process::id());
    info.iter()
        .filter_map(|window| {
            // Layer 0 holds normal application windows; menus, the Dock and
            // overlays sit on other layers.
            if number(&window, unsafe { kCGWindowLayer })? != 0 {
                return None;
            }
            if number(&window, unsafe { kCGWindowOwnerPID })? == own_pid {
                return None;
            }
            let id = number(&window, unsafe { kCGWindowNumber })?;
            let app_name = string(&window, unsafe { kCGWindowOwnerName });
            // Titles are only readable with Screen Recording access.
            let title = string(&window, unsafe { kCGWindowName }).filter(|t| !t.is_empty());
            if title.is_none() && app_name.is_none() {
                return None;
            }
            Some(ScreenCaptureSource {
                id: format!("window:{id}:0"),
                kind: ScreenCaptureSourceKind::Window,
                name: title,
                app_name,
                builtin: false,
            })
        })
        .collect()
}

fn value(
    window: &NSDictionary<NSString, AnyObject>,
    key: &CFString,
) -> Option<Retained<AnyObject>> {
    // SAFETY: CFString is toll-free bridged to NSString.
    let key: &NSString = unsafe { &*std::ptr::from_ref(key).cast() };
    window.objectForKey(key)
}

fn number(window: &NSDictionary<NSString, AnyObject>, key: &CFString) -> Option<i64> {
    value(window, key)?
        .downcast::<NSNumber>()
        .ok()
        .map(|number| number.longLongValue())
}

fn string(window: &NSDictionary<NSString, AnyObject>, key: &CFString) -> Option<String> {
    value(window, key)?
        .downcast::<NSString>()
        .ok()
        .map(|string| string.to_string())
}
