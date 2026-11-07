//! `AiEditingWorkerUrl`: aI editing worker API URL.

service_url::service_url! {
    /// AI editing worker API URL.
    pub struct AiEditingWorkerUrl {
        local: "http://localhost:8933",
        dev: "https://ai-editing-worker-dev.macroverse.workers.dev",
        prod: "https://ai-editing-worker.macroverse.workers.dev",
    }
}
