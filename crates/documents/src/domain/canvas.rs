//! Permission-scoped live Canvas reading and AI editing.

use super::{
    permission_token::encode_permission_token,
    ports::{
        DocumentService,
        editing::{EditUsage, EditingWorkerService, EditorName},
    },
};
use ai_billing::domain::admission::AiAdmissionService;
use ai_usage::{AiFeature, UsageAmount, UsageContext, UsageRecorder};
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt, ViewAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

/// Canvas workflow passed to the live editing peer.
#[derive(Debug, Serialize)]
#[serde(
    tag = "action",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum CanvasRequest {
    /// Read the live scene without mutation or model usage.
    Read {
        /// Filter to known stable IDs when the overview is truncated.
        #[serde(skip_serializing_if = "Option::is_none")]
        item_ids: Option<Vec<String>>,
        /// Concise graph or precise scene JSON.
        #[serde(skip_serializing_if = "Option::is_none")]
        format: Option<CanvasReadFormat>,
    },
    /// Produce a read-only image from an immutable live scene snapshot.
    Render {
        /// Optional item selection used to derive crop bounds.
        #[serde(skip_serializing_if = "Option::is_none")]
        item_ids: Option<Vec<String>>,
        /// Explicit world crop overrides selection bounds.
        #[serde(skip_serializing_if = "Option::is_none")]
        crop: Option<CanvasBounds>,
    },
    /// Apply a bounded SDK batch without invoking a second model.
    Apply {
        /// Exact immutable revision from ReadCanvas or RenderCanvas.
        expected_revision: String,
        /// Bounded JavaScript using the CanvasEditor SDK.
        code: String,
        /// Plain text separated from executable code.
        #[serde(skip_serializing_if = "Option::is_none")]
        snippets: Option<std::collections::BTreeMap<String, String>>,
        /// Ephemeral presentation identity.
        #[serde(skip_serializing_if = "Option::is_none")]
        editor_name: Option<String>,
    },
    /// Ask the sandboxed editor to change the live scene.
    Edit {
        /// User-requested changes; bounded before admission.
        instructions: String,
        /// Display name for ephemeral AI presence; durable attribution uses the token.
        #[serde(skip_serializing_if = "Option::is_none")]
        editor_name: Option<String>,
    },
}

/// Scene representation requested by a reader.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
pub enum CanvasReadFormat {
    /// Exact object data and geometry.
    Scene,
    /// Approximate compact graph with stable ID mapping.
    Overview,
}

/// World-space crop or object bounds.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
pub struct CanvasBounds {
    /// World x coordinate.
    pub x: f64,
    /// World y coordinate.
    pub y: f64,
    /// Positive world width.
    pub width: f64,
    /// Positive world height.
    pub height: f64,
}

/// Native PNG media recognized explicitly by the agent adapter.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CanvasImage {
    /// Always image.
    pub r#type: String,
    /// Always image/png.
    pub media_type: String,
    /// Bounded base64 image bytes, never a remote URL.
    pub data: String,
}

/// Stable object-to-image mapping.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct CanvasRenderObject {
    /// Canvas item ID.
    pub id: String,
    /// World-space bounds in the frozen scene.
    pub bounds: CanvasBounds,
}

/// Explicitly unavailable referenced content.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct CanvasUnavailable {
    /// Canvas item ID.
    pub id: String,
    /// Why no referenced resource was loaded.
    pub reason: String,
}

/// Actual browser text bounds and overflow for a read-only render.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
pub struct CanvasTextLayout {
    /// Stable item ID.
    pub id: String,
    /// Actual rendered text bounds in world coordinates.
    pub bounds: CanvasBounds,
    /// Whether the DOM text exceeds its intended text frame.
    pub overflow: bool,
}

/// Image and metadata captured from the same immutable revision.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CanvasRender {
    /// SHA-256 of the immutable scene snapshot and clock.
    pub revision: String,
    /// Source CRDT version vector.
    pub clock: std::collections::BTreeMap<String, u64>,
    /// World bounds mapped to the image rectangle.
    pub crop: CanvasBounds,
    /// PNG width in pixels.
    pub width: u32,
    /// PNG height in pixels.
    pub height: u32,
    /// Objects intersecting the world crop.
    pub objects: Vec<CanvasRenderObject>,
    /// Referenced content omitted without widening access.
    pub unavailable: Vec<CanvasUnavailable>,
    /// Actual DOM measurement from the same scene and render surface.
    #[serde(default)]
    pub text_layout: Vec<CanvasTextLayout>,
    /// Native media for the model and UI.
    pub model_media: Vec<CanvasImage>,
}

/// High-signal outcome shared by agent tools and caller integrations.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CanvasResponse {
    /// Immutable visual read, when requested.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub render: Option<CanvasRender>,
    /// Bounded scene JSON with stable item IDs, transforms, bounds and labels.
    pub canvas: Option<String>,
    /// Number of validated operations acknowledged by live storage.
    pub operations_applied: usize,
    /// Human-readable outcome; may report partial changes.
    pub summary: String,
    /// Missing information or unsupported operation, if any.
    pub clarification: Option<String>,
}

/// Internal worker result including billable per-model usage.
pub struct CanvasResult {
    /// A stopped or failed run still reports its completed provider usage.
    pub failure: Option<String>,
    /// Public operation outcome.
    pub response: CanvasResponse,
    /// Usage metered by the owning domain, including MCP invocations.
    pub usage: Vec<EditUsage>,
}

/// Metadata needed to select the Canvas workflow after access is checked.
#[cfg_attr(test, mockall::automock)]
pub trait CanvasDocumentLookup: Send + Sync + 'static {
    /// Native file type of an authorized document.
    fn file_type(
        &self,
        document_id: &str,
    ) -> impl std::future::Future<Output = anyhow::Result<Option<String>>> + Send;
}

impl<D: DocumentService> CanvasDocumentLookup for D {
    async fn file_type(&self, document_id: &str) -> anyhow::Result<Option<String>> {
        Ok(self
            .internal_get_basic_document(document_id)
            .await?
            .file_type)
    }
}

/// Composes document lookup, scoped worker execution and AI admission/metering.
pub struct CanvasService<D, W> {
    documents: Arc<D>,
    worker: Arc<W>,
    token_secret: String,
    admission: Arc<dyn AiAdmissionService>,
    recorder: Arc<dyn UsageRecorder>,
}

impl<D: CanvasDocumentLookup, W: EditingWorkerService> CanvasService<D, W> {
    /// Construct from the same dependencies used by document AI editing.
    pub fn new(
        documents: Arc<D>,
        worker: Arc<W>,
        token_secret: String,
        admission: Arc<dyn AiAdmissionService>,
        recorder: Arc<dyn UsageRecorder>,
    ) -> Self {
        Self {
            documents,
            worker,
            token_secret,
            admission,
            recorder,
        }
    }

    /// Read with a view-only capability. No model is called.
    pub async fn read(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        user: &MacroUserIdStr<'static>,
        actor: &str,
        item_ids: Option<Vec<String>>,
        format: Option<CanvasReadFormat>,
    ) -> anyhow::Result<CanvasResponse> {
        anyhow::ensure!(
            item_ids
                .as_ref()
                .is_none_or(|ids| ids.len() <= 100 && ids.iter().all(|id| id.len() <= 200)),
            "Read at most 100 Canvas item IDs of at most 200 bytes each."
        );
        self.ensure_canvas(&receipt.entity().entity_id).await?;
        Ok(self
            .run(
                &receipt.entity().entity_id,
                user,
                actor,
                AccessLevel::View,
                CanvasRequest::Read { item_ids, format },
            )
            .await?
            .response)
    }

    /// Render with the same view-only capability as scene reads; no model is called.
    #[tracing::instrument(skip_all, fields(document_id = %receipt.entity().entity_id), err)]
    pub async fn render(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        user: &MacroUserIdStr<'static>,
        actor: &str,
        item_ids: Option<Vec<String>>,
        crop: Option<CanvasBounds>,
    ) -> anyhow::Result<CanvasRender> {
        anyhow::ensure!(
            item_ids.as_ref().is_none_or(|ids| !ids.is_empty()
                && ids.len() <= 100
                && ids.iter().all(|id| !id.is_empty() && id.len() <= 200)),
            "Render at most 100 nonempty item IDs."
        );
        if let Some(crop) = &crop {
            anyhow::ensure!(
                [crop.x, crop.y, crop.width, crop.height]
                    .iter()
                    .all(|value| value.is_finite() && value.abs() <= 1_000_000.0)
                    && crop.width > 0.0
                    && crop.height > 0.0,
                "Invalid bounded Canvas crop."
            );
        }
        self.ensure_canvas(&receipt.entity().entity_id).await?;
        let result = self
            .run(
                &receipt.entity().entity_id,
                user,
                actor,
                AccessLevel::View,
                CanvasRequest::Render { item_ids, crop },
            )
            .await?;
        let render = result
            .response
            .render
            .ok_or_else(|| anyhow::anyhow!("Canvas renderer returned no image."))?;
        anyhow::ensure!(
            render.model_media.len() == 1
                && render
                    .model_media
                    .iter()
                    .all(|image| image.r#type == "image"
                        && image.media_type == "image/png"
                        && image.data.len() <= 4_000_000
                        && image.data.starts_with("iVBORw0KGgo")),
            "Invalid Canvas render image."
        );
        Ok(render)
    }

    /// Authorize, admit, run and meter one natural-language edit.
    #[tracing::instrument(skip_all, fields(document_id = %receipt.entity().entity_id), err)]
    pub async fn edit(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        user: &MacroUserIdStr<'static>,
        actor: &str,
        instructions: String,
        editor_name: Option<EditorName>,
    ) -> anyhow::Result<CanvasResponse> {
        anyhow::ensure!(
            !instructions.trim().is_empty() && instructions.len() <= 20000,
            "Canvas instructions must contain 1–20000 bytes."
        );
        // Type validation happens before admission and before the model can start.
        self.ensure_canvas(&receipt.entity().entity_id).await?;
        self.admission
            .admit(user, AiFeature::AiEditing)
            .await
            .map_err(|error| anyhow::anyhow!("{}: {error}", error.code()))?;
        let result = self
            .run(
                &receipt.entity().entity_id,
                user,
                actor,
                AccessLevel::Edit,
                CanvasRequest::Edit {
                    instructions,
                    editor_name: editor_name.map(|name| name.as_str().chars().take(64).collect()),
                },
            )
            .await?;
        let context = UsageContext::new(AiFeature::AiEditing, user.clone())
            .with_entity(macro_uuid::string_to_uuid(&receipt.entity().entity_id).ok());
        for usage in result.usage {
            self.recorder.record(context.clone().into_event(
                usage.model,
                UsageAmount::Tokens {
                    input: u64::from(usage.input_tokens),
                    output: u64::from(usage.output_tokens),
                    cache_read: 0,
                    cache_write: 0,
                },
            ));
        }
        if let Some(error) = result.failure {
            anyhow::bail!(
                "Canvas editing stopped after {} acknowledged operations: {error}. Further partial edits may have applied. ReadCanvas before retrying.",
                result.response.operations_applied
            );
        }
        Ok(result.response)
    }

    /// Apply an already planned batch using edit capability; no nested model or model billing.
    #[tracing::instrument(skip_all, fields(document_id = %receipt.entity().entity_id), err)]
    pub async fn apply(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        user: &MacroUserIdStr<'static>,
        actor: &str,
        request: CanvasRequest,
    ) -> anyhow::Result<CanvasResponse> {
        let CanvasRequest::Apply {
            expected_revision,
            code,
            snippets,
            ..
        } = &request
        else {
            anyhow::bail!("Expected a direct Canvas SDK batch.");
        };
        anyhow::ensure!(
            expected_revision.len() == 64
                && expected_revision.bytes().all(|b| b.is_ascii_hexdigit()),
            "Use the immutable revision from a fresh ReadCanvas."
        );
        anyhow::ensure!(
            !code.trim().is_empty() && code.len() <= 50000,
            "Canvas code must contain 1–50000 bytes."
        );
        anyhow::ensure!(
            snippets.as_ref().is_none_or(|values| values.len() <= 100
                && values
                    .iter()
                    .all(|(key, value)| key.len() <= 200 && value.len() <= 20000)
                && values.values().map(String::len).sum::<usize>() <= 50000),
            "Canvas snippets exceed the bounded text budget."
        );
        self.ensure_canvas(&receipt.entity().entity_id).await?;
        let result = self
            .run(
                &receipt.entity().entity_id,
                user,
                actor,
                AccessLevel::Edit,
                request,
            )
            .await?;
        anyhow::ensure!(
            result.usage.is_empty(),
            "Direct Canvas edits must not invoke a model."
        );
        if let Some(error) = result.failure {
            anyhow::bail!(
                "Canvas batch stopped after {} acknowledged operations: {error}. ReadCanvas before retrying; a lost acknowledgement is uncertain.",
                result.response.operations_applied
            );
        }
        Ok(result.response)
    }

    async fn ensure_canvas(&self, document_id: &str) -> anyhow::Result<()> {
        let file_type = self.documents.file_type(document_id).await?;
        anyhow::ensure!(
            file_type.as_deref() == Some("canvas"),
            "This tool requires a Macro canvas. Use the matching document tool for other file types."
        );
        Ok(())
    }

    async fn run(
        &self,
        document_id: &str,
        user: &MacroUserIdStr<'static>,
        actor: &str,
        access: AccessLevel,
        request: CanvasRequest,
    ) -> anyhow::Result<CanvasResult> {
        let token = encode_permission_token(
            Some(user.to_string()),
            document_id.to_owned(),
            access,
            &self.token_secret,
            Some(actor.to_owned()),
        )?;
        self.worker.canvas(document_id, &token, &request).await
    }
}

#[cfg(test)]
mod test;
