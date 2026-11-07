//! `UnfurlServiceUrl`: link unfurl service API URL.

service_url::service_url! {
    /// Link unfurl service API URL.
    pub struct UnfurlServiceUrl {
        local: "http://localhost:8095",
        dev: "https://dev-gateway.macro.com/unfurl",
        prod: "https://gateway.macro.com/unfurl",
    }
}
