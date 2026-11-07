//! `LexicalServiceUrl`: lexical conversion service API URL.

service_url::service_url! {
    /// Lexical conversion service API URL.
    pub struct LexicalServiceUrl {
        local: "http://localhost:8096",
        dev: "https://dev-gateway.macro.com/lexical",
        prod: "https://gateway.macro.com/lexical",
    }
}
