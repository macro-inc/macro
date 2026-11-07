//! `GooglePeopleApiUrl`: Google People API base.

service_url::service_url! {
    /// Google People API base. Google's host in every environment; override
    /// it to run against `crates/testing/gmail_emulator`.
    pub struct GooglePeopleApiUrl {
        local: "https://people.googleapis.com/v1",
        dev: "https://people.googleapis.com/v1",
        prod: "https://people.googleapis.com/v1",
    }
}
