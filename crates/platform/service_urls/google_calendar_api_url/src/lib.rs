//! `GoogleCalendarApiUrl`: Google Calendar REST API base.

service_url::service_url! {
    /// Google Calendar REST API base. Google's host in every environment;
    /// override it to run against `crates/testing/gmail_emulator`.
    pub struct GoogleCalendarApiUrl {
        local: "https://www.googleapis.com/calendar/v3",
        dev: "https://www.googleapis.com/calendar/v3",
        prod: "https://www.googleapis.com/calendar/v3",
    }
}
