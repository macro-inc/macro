//! Outbound adapter generating images with Google's Gemini image models
//! ("Nano Banana") over the GenerateContent REST API.

use std::time::Duration;

use ai_usage::{UsageAmount, UsageContext, UsageRecorder};
use anyhow::Context as _;
use base64::Engine as _;
use serde::Deserialize;

use crate::domain::models::{GeneratedImage, ImageGenerationError, ImageGenerationRequest};
use crate::domain::ports::ImageGenerator;

#[cfg(test)]
mod test;

/// Gemini's native image model, marketed as Nano Banana.
pub const NANO_BANANA_MODEL: &str = "gemini-2.5-flash-image";

const DEFAULT_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

/// Image generation runs for tens of seconds; well past a chat completion.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

/// Reqwest-backed [`ImageGenerator`] over the Gemini API.
#[derive(Clone)]
pub struct GeminiImageGenerator {
    client: reqwest::Client,
    base_url: String,
    api_key: String,
    model: String,
}

impl GeminiImageGenerator {
    /// A generator calling [`NANO_BANANA_MODEL`] with `api_key`.
    pub fn new(api_key: String) -> Self {
        Self {
            client: reqwest::Client::new(),
            base_url: DEFAULT_BASE_URL.to_string(),
            api_key,
            model: NANO_BANANA_MODEL.to_string(),
        }
    }

    /// Call a different Gemini image model.
    pub fn with_model(mut self, model: impl Into<String>) -> Self {
        self.model = model.into();
        self
    }

    /// Call a different API root (tests, proxies).
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into().trim_end_matches('/').to_string();
        self
    }

    fn request_body(&self, request: &ImageGenerationRequest) -> serde_json::Value {
        let mut parts = vec![serde_json::json!({ "text": request.prompt })];
        parts.extend(request.reference_images.iter().map(|image| {
            serde_json::json!({
                "inlineData": {
                    "mimeType": image.mime_type,
                    "data": base64::engine::general_purpose::STANDARD.encode(&image.bytes),
                }
            })
        }));
        let mut generation_config = serde_json::json!({ "responseModalities": ["IMAGE"] });
        if let Some(aspect_ratio) = request.aspect_ratio {
            generation_config["imageConfig"] =
                serde_json::json!({ "aspectRatio": aspect_ratio.as_ratio() });
        }
        serde_json::json!({
            "contents": [{ "role": "user", "parts": parts }],
            "generationConfig": generation_config,
        })
    }
}

#[async_trait::async_trait]
impl ImageGenerator for GeminiImageGenerator {
    #[tracing::instrument(skip_all, fields(model = %self.model), err)]
    async fn generate_image(
        &self,
        request: &ImageGenerationRequest,
        usage: &UsageContext,
        recorder: &dyn UsageRecorder,
    ) -> Result<GeneratedImage, ImageGenerationError> {
        let response = self
            .client
            .post(format!(
                "{}/models/{}:generateContent",
                self.base_url, self.model
            ))
            .header("x-goog-api-key", &self.api_key)
            .timeout(REQUEST_TIMEOUT)
            .json(&self.request_body(request))
            .send()
            .await
            .context("Gemini request failed")
            .map_err(ImageGenerationError::Provider)?;

        let status = response.status();
        let body = response
            .text()
            .await
            .context("failed to read Gemini response")
            .map_err(ImageGenerationError::Provider)?;
        if !status.is_success() {
            let message = serde_json::from_str::<ErrorEnvelope>(&body)
                .ok()
                .map(|envelope| envelope.error.message)
                .unwrap_or(body);
            return Err(ImageGenerationError::Provider(anyhow::anyhow!(
                "Gemini returned HTTP {status}: {message}"
            )));
        }

        let parsed: GenerateContentResponse = serde_json::from_str(&body)
            .context("unexpected Gemini response shape")
            .map_err(ImageGenerationError::Provider)?;
        if let Some(metadata) = &parsed.usage_metadata {
            // The image model publishes no cached-input rate, so implicit
            // cache reads stay inside the prompt count at the input rate.
            recorder.record(usage.clone().into_event(
                self.model.clone(),
                UsageAmount::Tokens {
                    input: metadata.prompt_token_count,
                    output: metadata.candidates_token_count.unwrap_or_else(|| {
                        metadata
                            .total_token_count
                            .unwrap_or(metadata.prompt_token_count)
                            .saturating_sub(metadata.prompt_token_count)
                    }),
                    cache_read: 0,
                    cache_write: 0,
                },
            ));
        } else {
            tracing::warn!(model = %self.model, "Gemini image response omitted usage metadata");
        }
        parsed.into_image()
    }
}

#[derive(Deserialize)]
struct ErrorEnvelope {
    error: ErrorBody,
}

#[derive(Deserialize)]
struct ErrorBody {
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GenerateContentResponse {
    #[serde(default)]
    candidates: Vec<Candidate>,
    prompt_feedback: Option<PromptFeedback>,
    usage_metadata: Option<UsageMetadata>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct UsageMetadata {
    prompt_token_count: u64,
    // Gemini can omit candidate counts. This non-thinking, IMAGE-only request
    // can also recover output usage from the reported total minus prompt.
    candidates_token_count: Option<u64>,
    total_token_count: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PromptFeedback {
    block_reason: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    content: Option<Content>,
    finish_reason: Option<String>,
}

#[derive(Deserialize)]
struct Content {
    #[serde(default)]
    parts: Vec<Part>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Part {
    text: Option<String>,
    inline_data: Option<InlineData>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InlineData {
    mime_type: String,
    data: String,
}

impl GenerateContentResponse {
    /// The first image in the response, with any accompanying text as its
    /// note. A response without an image is a refusal: the prompt was
    /// blocked, or the model answered in words.
    fn into_image(self) -> Result<GeneratedImage, ImageGenerationError> {
        if let Some(reason) = self
            .prompt_feedback
            .and_then(|feedback| feedback.block_reason)
        {
            return Err(ImageGenerationError::Refused(format!(
                "the prompt was blocked ({reason}); rephrase it and try again"
            )));
        }

        let mut image = None;
        let mut text = Vec::new();
        let mut finish_reason = None;
        for candidate in self.candidates {
            finish_reason = finish_reason.or(candidate.finish_reason);
            for part in candidate
                .content
                .into_iter()
                .flat_map(|content| content.parts)
            {
                match part {
                    Part {
                        inline_data: Some(data),
                        ..
                    } if image.is_none() => image = Some(data),
                    Part {
                        text: Some(text_part),
                        ..
                    } if !text_part.trim().is_empty() => text.push(text_part.trim().to_string()),
                    _ => {}
                }
            }
        }
        let note = (!text.is_empty()).then(|| text.join("\n"));

        let Some(data) = image else {
            let reason = match (note, finish_reason) {
                (Some(text), _) => format!("the model returned no image, only text: {text}"),
                (None, Some(reason)) => {
                    format!("the model returned no image (finish reason {reason})")
                }
                (None, None) => "the model returned no image".to_string(),
            };
            return Err(ImageGenerationError::Refused(reason));
        };
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(data.data.as_bytes())
            .context("Gemini image data is not valid base64")
            .map_err(ImageGenerationError::Provider)?;
        let (width, height) = image::ImageReader::new(std::io::Cursor::new(&bytes))
            .with_guessed_format()
            .context("could not identify generated image format")
            .and_then(|reader| {
                reader
                    .into_dimensions()
                    .context("could not read generated image dimensions")
            })
            .map_err(ImageGenerationError::Provider)?;
        if width == 0 || height == 0 {
            return Err(ImageGenerationError::Provider(anyhow::anyhow!(
                "generated image dimensions must be positive"
            )));
        }
        Ok(GeneratedImage {
            width,
            height,
            bytes,
            mime_type: data.mime_type,
            note,
        })
    }
}
