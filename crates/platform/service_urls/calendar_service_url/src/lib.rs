//! `CalendarServiceUrl`: calendar service API URL. The calendar write authority once

service_url::service_url! {
    /// Calendar service API URL. The calendar write authority once
    /// `calendar_service` owns provider mutations; its API is mounted at
    /// the root and under the `/calendar` gateway prefix.
    pub struct CalendarServiceUrl {
        local: "http://localhost:8088",
        dev: "https://dev-gateway.macro.com/calendar",
        prod: "https://gateway.macro.com/calendar",
    }
}
