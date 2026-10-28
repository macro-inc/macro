//! UIKit sends this warning to the host even when WebContent is unresponsive.

use std::{cell::RefCell, ptr::NonNull};

use block2::RcBlock;
use objc2::{rc::Retained, runtime::ProtocolObject};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSObjectProtocol};
use objc2_ui_kit::UIApplicationDidReceiveMemoryWarningNotification;
use tauri::Manager;

use super::{Diagnostics, events::NativeEvent};

thread_local! {
    // Registration is installed once on the UI thread and retained for the host lifetime.
    static OBSERVER: RefCell<Option<Retained<ProtocolObject<dyn NSObjectProtocol>>>> = const { RefCell::new(None) };
}

pub fn observe_memory_warnings<R: tauri::Runtime>(app: tauri::AppHandle<R>) {
    let callback = RcBlock::new(move |_: NonNull<NSNotification>| {
        if let Some(state) = app.try_state::<Diagnostics>() {
            state.record_native_event(NativeEvent::MemoryWarning);
        }
    });
    // SAFETY: No object filter or operation queue. The callback captures only
    // the Send + Sync AppHandle and uses the diagnostic buffer's mutex.
    let observer = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(UIApplicationDidReceiveMemoryWarningNotification),
            None,
            None,
            &callback,
        )
    };
    OBSERVER.with(|slot| *slot.borrow_mut() = Some(observer));
}
