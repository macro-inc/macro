//! macOS owns delivered notifications beyond the lifetime of a webview. Keep
//! their navigation in the native response delegate and the deep-link bridge.

use std::cell::RefCell;

use block2::DynBlock;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{AnyThread, DefinedClass, define_class, msg_send};
use objc2_foundation::{NSObject, NSObjectProtocol};
use objc2_user_notifications::{
    UNNotification, UNNotificationDefaultActionIdentifier, UNNotificationPresentationOptions,
    UNNotificationResponse, UNUserNotificationCenter, UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Manager};
use url::Url;

thread_local! {
    // UNUserNotificationCenter.delegate is weak. Retain it for the app lifetime
    // on the setup thread; callbacks only access the thread-safe AppHandle.
    static DELEGATE: RefCell<Option<Retained<NotificationDelegate>>> = const { RefCell::new(None) };
}

define_class!(
    // SAFETY: NSObject imposes no subclassing requirements. The only ivar is a
    // thread-safe AppHandle, and there is no custom Drop implementation.
    #[unsafe(super = NSObject)]
    #[ivars = AppHandle]
    struct NotificationDelegate;

    unsafe impl NSObjectProtocol for NotificationDelegate {}

    // SAFETY: All methods match the UserNotifications protocol signatures.
    unsafe impl UNUserNotificationCenterDelegate for NotificationDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion.call((UNNotificationPresentationOptions::Banner
                | UNNotificationPresentationOptions::List
                | UNNotificationPresentationOptions::Sound,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &DynBlock<dyn Fn()>,
        ) {
            // SAFETY: this immutable framework constant is available on every
            // supported macOS version. Dismissal is never a navigation action.
            if &*response.actionIdentifier() == unsafe { UNNotificationDefaultActionIdentifier } {
                let identifier = response.notification().request().identifier().to_string();
                activate(self.ivars(), notification_url(&identifier));
            }
            completion.call(());
        }
    }
);

pub fn install_delegate(app: &AppHandle) {
    // Unbundled dev executables cannot use UserNotifications.
    if super::ensure_application_bundle().is_err() {
        return;
    }
    let delegate = NotificationDelegate::alloc().set_ivars(app.clone());
    // SAFETY: NSObject's initializer is valid for this subclass with its ivars set.
    let delegate: Retained<NotificationDelegate> = unsafe { msg_send![super(delegate), init] };
    UNUserNotificationCenter::currentNotificationCenter()
        .setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    DELEGATE.with(|slot| *slot.borrow_mut() = Some(delegate));
}

pub(super) fn notification_url(identifier: &str) -> Option<Url> {
    let url = Url::parse(identifier).ok()?;
    (url.scheme() == crate::APP_SCHEME
        && url.host_str().is_none()
        && url.path() == "/notification"
        && url
            .query_pairs()
            .any(|(key, value)| key == "notificationId" && !value.is_empty()))
    .then_some(url)
}

#[tracing::instrument(skip_all, fields(notification_id))]
fn activate(app: &AppHandle, destination: Option<Url>) {
    let span = tracing::Span::current();
    if let Some(url) = &destination
        && let Some((_, notification_id)) =
            url.query_pairs().find(|(key, _)| key == "notificationId")
    {
        span.record("notification_id", notification_id.as_ref());
    }
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let _entered = span.enter();
        if let Err(error) = handle.show() {
            tracing::warn!(?error, "Unable to show Macro for notification");
        }
        if let Some(window) = handle.get_webview_window("main") {
            for result in [window.unminimize(), window.show(), window.set_focus()] {
                if let Err(error) = result {
                    tracing::warn!(?error, "Unable to focus notification window");
                }
            }
        }
        if let Some(url) = destination {
            crate::deliver_deep_link(url, &handle);
        }
    }) {
        tracing::error!(?error, "Unable to dispatch notification activation");
    }
}
