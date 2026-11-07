//! `ContactsServiceUrl`: contacts service API URL.

service_url::service_url! {
    /// Contacts service API URL.
    pub struct ContactsServiceUrl {
        local: "http://localhost:8083",
        dev: "https://dev-gateway.macro.com/contacts",
        prod: "https://gateway.macro.com/contacts",
    }
}
