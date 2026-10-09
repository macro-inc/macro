//! Vercel AI SDK worker transport; keys stay outside the Deno sandbox.
use crate::domain::ai::{CodeAiProvider, GenerationRequest, GenerationResult};
use async_trait::async_trait;
use futures::StreamExt;

/// Internal, authenticated worker client without request retries.
pub struct AiWorker {
    url: String,
    key: String,
    client: reqwest::Client,
}

impl AiWorker {
    /// Use the deployment's existing editing-worker URL and internal API key.
    pub fn new(url: String, key: String) -> Self {
        Self {
            url: format!("{}/code-mode/generate", url.trim_end_matches('/')),
            key,
            client: reqwest::Client::new(),
        }
    }
}

#[async_trait]
impl CodeAiProvider for AiWorker {
    async fn generate(&self, request: &GenerationRequest) -> anyhow::Result<GenerationResult> {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let response = self
            .client
            .post(&self.url)
            .headers(headers)
            .header("x-internal-auth-key", &self.key)
            .timeout(std::time::Duration::from_secs(28))
            .json(request)
            .send()
            .await
            .map_err(|_| anyhow::anyhow!("AI generation worker is unavailable."))?;
        anyhow::ensure!(
            response.status().is_success(),
            "AI generation failed. Check the SDK inputs or try again later."
        );
        let mut stream = response.bytes_stream();
        let mut body = Vec::new();
        while let Some(bytes) = stream.next().await {
            let bytes =
                bytes.map_err(|_| anyhow::anyhow!("AI generation response was interrupted."))?;
            anyhow::ensure!(
                body.len() + bytes.len() <= 240 * 1024,
                "AI generation response exceeded its limit."
            );
            body.extend_from_slice(&bytes);
        }
        serde_json::from_slice(&body)
            .map_err(|_| anyhow::anyhow!("AI generation returned an invalid response."))
    }
}
