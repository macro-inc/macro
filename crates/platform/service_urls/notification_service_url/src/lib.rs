//! `NotificationServiceUrl`: notification service API URL.

service_url::service_url! {
    /// Notification service API URL.
    pub struct NotificationServiceUrl {
        local: "http://localhost:8089",
        dev: "https://dev-gateway.macro.com/notification",
        prod: "https://gateway.macro.com/notification",
    }
}
