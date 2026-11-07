//! `GoogleGenerativeAiApiUrl`: gemini API host, where the agent's model router sends GenerateContent

service_url::service_url! {
    /// Gemini API host, where the agent's model router sends GenerateContent
    /// requests. Google's host in every environment; override it to run
    /// against `crates/testing/model_emulator`.
    pub struct GoogleGenerativeAiApiUrl {
        local: "https://generativelanguage.googleapis.com",
        dev: "https://generativelanguage.googleapis.com",
        prod: "https://generativelanguage.googleapis.com",
    }
}
