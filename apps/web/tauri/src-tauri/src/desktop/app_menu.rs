//! The macOS app menu: Tauri's default menu, except that Cmd+W closes the
//! active tab instead of the window.
//!
//! Tauri's default menu binds Cmd+W to a native Close Window item, and the menu
//! claims the key before the page's hotkeys see it, so Cmd+W quit the app
//! instead of closing a desktop tab. File > Close Tab takes Cmd+W and forwards
//! it to the focused window's frontend (`useCloseTabShortcut` in
//! `apps/web/src/components/app/tab-layout/close-tab-shortcut.ts`), which closes
//! the active tab, or the window when no other tab is open. Window > Close
//! Window keeps a way to close the window from the menu, without a shortcut.
//! The title bar's close button does not go through the menu.

use objc2::runtime::AnyObject;
use objc2::{class, msg_send};
use tauri::menu::{
    AboutMetadata, HELP_SUBMENU_ID, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu,
    WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter, EventTarget, Manager, WebviewWindow};

use crate::AppRuntime;

/// The event the frontend listens for; keep in sync with `CLOSE_TAB_EVENT` in
/// `close-tab-shortcut.ts`.
const CLOSE_TAB_EVENT: &str = "desktop-close-tab";
const CLOSE_TAB_ID: &str = "close_tab";
const CLOSE_WINDOW_ID: &str = "close_window";

/// Replaces Tauri's default menu with this one and handles its items. Installed
/// at setup from the desktop tree, so the shared `lib.rs` that mobile builds
/// compile stays untouched.
pub(crate) fn install(app: &AppHandle<AppRuntime>) -> tauri::Result<()> {
    app.set_menu(build(app)?)?;
    app.on_menu_event(on_menu_event);
    Ok(())
}

/// Builds the app menu, mirroring `tauri::menu::Menu::default` on macOS.
fn build(app: &AppHandle<AppRuntime>) -> tauri::Result<Menu<AppRuntime>> {
    let package = app.package_info();
    let config = app.config();
    let about = AboutMetadata {
        name: Some(package.name.clone()),
        version: Some(package.version.to_string()),
        copyright: config.bundle.copyright.clone(),
        authors: config
            .bundle
            .publisher
            .clone()
            .map(|publisher| vec![publisher]),
        ..Default::default()
    };

    let app_menu = Submenu::with_items(
        app,
        package.name.clone(),
        true,
        &[
            &PredefinedMenuItem::about(app, None, Some(about))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[&MenuItem::with_id(
            app,
            CLOSE_TAB_ID,
            "Close Tab",
            true,
            Some("CmdOrCtrl+W"),
        )?],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ],
    )?;

    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[&PredefinedMenuItem::fullscreen(app, None)?],
    )?;

    let window_menu = Submenu::with_id_and_items(
        app,
        WINDOW_SUBMENU_ID,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, CLOSE_WINDOW_ID, "Close Window", true, None::<&str>)?,
        ],
    )?;

    let help_menu = Submenu::with_id_and_items(app, HELP_SUBMENU_ID, "Help", true, &[])?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

/// Handles the menu's own items; predefined items act natively.
fn on_menu_event(app: &AppHandle<AppRuntime>, event: MenuEvent) {
    let id = event.id().as_ref();
    if id != CLOSE_TAB_ID && id != CLOSE_WINDOW_ID {
        return;
    }

    // Windows Tauri doesn't track (a sign-in popup wry opened, Web Inspector)
    // have no tabs and no listener: both items close them, as the default
    // Close Window item did.
    let Some(window) = focused_window(app) else {
        close_key_window();
        return;
    };

    let result = if id == CLOSE_TAB_ID {
        let target = EventTarget::webview_window(window.label());
        app.emit_to(target, CLOSE_TAB_EVENT, ())
    } else {
        window.close()
    };

    if let Err(error) = result {
        tracing::warn!(%error, menu_item = id, window = %window.label(), "menu item failed");
    }
}

fn focused_window(app: &AppHandle<AppRuntime>) -> Option<WebviewWindow<AppRuntime>> {
    app.webview_windows()
        .into_values()
        .find(|window| window.is_focused().unwrap_or(false))
}

/// Closes the key window the way the default Close Window item does, by
/// sending it `performClose:`. Menu events arrive on the main thread.
fn close_key_window() {
    // SAFETY: called on the main thread; `sharedApplication` and `keyWindow`
    // take no arguments, `keyWindow` may be nil (checked), and `performClose:`
    // takes an optional sender.
    unsafe {
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let window: *mut AnyObject = msg_send![app, keyWindow];
        if window.is_null() {
            return;
        }
        let _: () = msg_send![window, performClose: std::ptr::null::<AnyObject>()];
    }
}
