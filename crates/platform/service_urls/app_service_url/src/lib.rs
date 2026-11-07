//! `AppServiceUrl`: main app URL.

service_url::service_url! {
    /// Main app URL.
    pub struct AppServiceUrl {
        local: "http://localhost:3000",
        dev: "https://dev.macro.com",
        prod: "https://macro.com",
    }
}
