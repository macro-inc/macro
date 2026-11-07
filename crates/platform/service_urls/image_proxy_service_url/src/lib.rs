//! `ImageProxyServiceUrl`: image proxy service API URL.

service_url::service_url! {
    /// Image proxy service API URL.
    pub struct ImageProxyServiceUrl {
        local: "http://localhost:8097",
        dev: "https://dev-gateway.macro.com/image-proxy",
        prod: "https://gateway.macro.com/image-proxy",
    }
}
