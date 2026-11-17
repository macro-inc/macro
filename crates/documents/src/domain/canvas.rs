//! Permission-scoped live Canvas reading and AI editing.

use super::{
    permission_token::encode_permission_token,
    ports::{
        DocumentService,
        editing::{EditUsage, EditingWorkerService, EditorName},
    },
};
use ai_billing::domain::admission::{AiAdmissionError, AiAdmissionService};
use ai_usage::{AiFeature, UsageAmount, UsageContext, UsageRecorder};
use entity_access::domain::models::{
    EditAccessLevel, EntityAccessAuth, EntityAccessReceipt, RequiredPermission, ViewAccessLevel,
};
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

/// Per-user answer to whether Canvas artifacts are on. Flags never grant access.
pub type CanvasArtifactsRollout = std::sync::Arc<
    dyn Fn(
            MacroUserIdStr<'static>,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = bool> + Send>>
        + Send
        + Sync,
>;

/// Scene representation requested by a reader.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, JsonSchema)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
#[serde(rename_all = "lowercase")]
pub enum CanvasReadFormat {
    /// Exact object data and geometry.
    Scene,
    /// Approximate compact graph with stable ID mapping.
    Overview,
}

/// World-space crop or object bounds.
#[derive(Debug, Clone, Deserialize, Serialize, JsonSchema)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
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
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct CanvasRenderObject {
    /// Canvas item ID.
    pub id: String,
    /// World-space bounds in the frozen scene.
    pub bounds: CanvasBounds,
}

/// Explicitly unavailable referenced content.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct CanvasUnavailable {
    /// Canvas item ID.
    pub id: String,
    /// Why no referenced resource was loaded.
    pub reason: String,
}

/// Actual browser text bounds and overflow for a read-only render.
#[derive(Debug, Deserialize, Serialize, JsonSchema)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
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

/// Why a Canvas read, render or edit did not complete.
#[derive(Debug, thiserror::Error)]
pub enum CanvasError {
    /// The request or document does not fit this workflow; nothing ran.
    #[error("{0}")]
    Invalid(String),
    /// AI admission refused the caller; no model ran.
    #[error("{code}: {0}", code = .0.code())]
    Admission(AiAdmissionError),
    /// The scene changed since the batch's expected revision; nothing was committed.
    #[error("{0}")]
    Conflict(String),
    /// The batch failed validation or planning before it committed; nothing changed.
    #[error("{0}")]
    Rejected(String),
    /// Looking up the document or preparing the call failed before the worker ran.
    #[error(transparent)]
    Internal(anyhow::Error),
    /// The worker failed. A write may have partly applied.
    #[error(transparent)]
    Failed(anyhow::Error),
}

/// A rendered Canvas PNG kept in static file storage.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredCanvasImage {
    /// Static file id.
    pub file_id: String,
    /// Permanent URL of the image bytes.
    pub url: String,
}

/// Keeps rendered Canvas images as static files owned by the caller.
// async_trait: the router holds the store as `Arc<dyn CanvasImageStore>`.
#[async_trait::async_trait]
pub trait CanvasImageStore: Send + Sync + 'static {
    /// Store PNG bytes for `owner` and return where they live.
    async fn save_png(
        &self,
        owner: &MacroUserIdStr<'static>,
        name: &str,
        png: Vec<u8>,
    ) -> anyhow::Result<StoredCanvasImage>;
}

/// A render whose image was stored rather than returned inline.
#[derive(Debug)]
pub struct StoredCanvasRender {
    /// The stored PNG.
    pub image: StoredCanvasImage,
    /// The render's metadata; its `model_media` is empty.
    pub render: CanvasRender,
}

/// Who a Canvas call outside an agent turn runs as: the acting user, and the
/// bot acting for them when there is one, which attributes edits the way the
/// Canvas tools do.
#[derive(Debug, Clone)]
pub struct CanvasCaller {
    /// The user whose access, billing and file ownership apply.
    pub user: MacroUserIdStr<'static>,
    /// The bot's storage id, as the token's attribution actor.
    pub actor: Option<String>,
    /// The bot's display name for AI presence, when it is a system bot.
    pub editor: Option<EditorName>,
}

impl CanvasCaller {
    /// The caller behind a receipt; `None` when no user acts, such as a bot
    /// with no acting user or an internal call, which have no one to bill.
    pub fn of<T: RequiredPermission>(receipt: &EntityAccessReceipt<T>) -> Option<Self> {
        let bot = match receipt.auth() {
            EntityAccessAuth::Bot(bot) => Some(bot.bot_id()),
            EntityAccessAuth::Authenticated(_)
            | EntityAccessAuth::Unauthenticated
            | EntityAccessAuth::Internal => None,
        };
        Some(Self {
            user: receipt.acting_user_id()?.clone(),
            actor: bot.map(|bot| bot.into_storage_id().to_string()),
            editor: bot
                .and_then(|bot| bot_id::system_bot(bot).and_then(|bot| EditorName::new(bot.name))),
        })
    }
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

/// A document node a server-side flow adds to a canvas, shaped like the
/// node the canvas UI inserts. Agents' CanvasEditor snippets cannot create
/// one; only this request, which the worker accepts from internal callers,
/// can.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CanvasDocumentEmbed {
    /// The node's canvas item id. The worker leaves a node already committed
    /// under it as it is, so a retried embed adds one node.
    pub item_id: uuid::Uuid,
    /// The embedded document.
    pub document_id: String,
    /// Its name, shown on the node.
    pub name: String,
    /// Its file type.
    pub file_type: String,
    /// Host navigation state inside the document.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subpath: Option<String>,
    /// World x of the top-left corner.
    pub x: f64,
    /// World y of the top-left corner.
    pub y: f64,
    /// Width.
    pub width: f64,
    /// Height.
    pub height: f64,
    /// The canvas's entity mention of the document, tracked next to the node
    /// in the same commit so the canvas UI sees the reference as recorded.
    pub mention_id: uuid::Uuid,
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
    artifacts: bool,
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
            artifacts: false,
            token_secret,
            admission,
            recorder,
        }
    }

    /// Say whether the requesting user has the artifacts rollout.
    pub fn with_artifacts(mut self, artifacts: bool) -> Self {
        self.artifacts = artifacts;
        self
    }

    /// Read with a view-only capability. No model is called.
    pub async fn read(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        user: &MacroUserIdStr<'static>,
        actor: Option<&str>,
        item_ids: Option<Vec<String>>,
        format: Option<CanvasReadFormat>,
    ) -> Result<CanvasResponse, CanvasError> {
        ensure(
            item_ids
                .as_ref()
                .is_none_or(|ids| ids.len() <= 100 && ids.iter().all(|id| id.len() <= 200)),
            "Read at most 100 Canvas item IDs of at most 200 bytes each.",
        )?;
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
        actor: Option<&str>,
        item_ids: Option<Vec<String>>,
        crop: Option<CanvasBounds>,
    ) -> Result<CanvasRender, CanvasError> {
        ensure(
            item_ids.as_ref().is_none_or(|ids| {
                !ids.is_empty()
                    && ids.len() <= 100
                    && ids.iter().all(|id| !id.is_empty() && id.len() <= 200)
            }),
            "Render at most 100 nonempty item IDs.",
        )?;
        if let Some(crop) = &crop {
            ensure(
                [crop.x, crop.y, crop.width, crop.height]
                    .iter()
                    .all(|value| value.is_finite() && value.abs() <= 1_000_000.0)
                    && crop.width > 0.0
                    && crop.height > 0.0,
                "Invalid bounded Canvas crop.",
            )?;
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
        let render = result.response.render.ok_or_else(|| {
            CanvasError::Failed(anyhow::anyhow!("Canvas renderer returned no image."))
        })?;
        if !(render.model_media.len() == 1
            && render.model_media.iter().all(|image| {
                image.r#type == "image"
                    && image.media_type == "image/png"
                    && image.data.len() <= 4_000_000
                    && image.data.starts_with("iVBORw0KGgo")
            }))
        {
            return Err(CanvasError::Failed(anyhow::anyhow!(
                "Invalid Canvas render image."
            )));
        }
        Ok(render)
    }

    /// Render like [`Self::render`] and keep the PNG as a static file owned by
    /// `user`, for callers that pass images by reference rather than inline.
    #[tracing::instrument(skip_all, fields(document_id = %receipt.entity().entity_id, file_id), err)]
    pub async fn render_to_file(
        &self,
        receipt: EntityAccessReceipt<ViewAccessLevel>,
        user: &MacroUserIdStr<'static>,
        actor: Option<&str>,
        item_ids: Option<Vec<String>>,
        crop: Option<CanvasBounds>,
        images: &dyn CanvasImageStore,
    ) -> Result<StoredCanvasRender, CanvasError> {
        use base64::Engine as _;
        let document_id = receipt.entity().entity_id.clone();
        let mut render = self.render(receipt, user, actor, item_ids, crop).await?;
        let media = std::mem::take(&mut render.model_media);
        let png = media
            .into_iter()
            .next()
            .map(|image| base64::engine::general_purpose::STANDARD.decode(image.data))
            .transpose()
            .map_err(|error| CanvasError::Failed(error.into()))?
            .ok_or_else(|| CanvasError::Failed(anyhow::anyhow!("Canvas render had no image.")))?;
        let image = images
            .save_png(user, &format!("canvas-{document_id}.png"), png)
            .await
            .map_err(CanvasError::Internal)?;
        tracing::Span::current().record("file_id", image.file_id.as_str());
        Ok(StoredCanvasRender { image, render })
    }

    /// Authorize, admit, run and meter one natural-language edit.
    #[tracing::instrument(skip_all, fields(document_id = %receipt.entity().entity_id), err)]
    pub async fn edit(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        user: &MacroUserIdStr<'static>,
        actor: Option<&str>,
        instructions: String,
        editor_name: Option<EditorName>,
    ) -> Result<CanvasResponse, CanvasError> {
        ensure(
            !instructions.trim().is_empty() && instructions.len() <= 20000,
            "Canvas instructions must contain 1–20000 bytes.",
        )?;
        // Type validation happens before admission and before the model can start.
        self.ensure_canvas(&receipt.entity().entity_id).await?;
        self.admission
            .admit(user, AiFeature::AiEditing)
            .await
            .map_err(CanvasError::Admission)?;
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
            return Err(CanvasError::Failed(anyhow::anyhow!(
                "Canvas editing stopped after {} acknowledged operations: {error}. Further partial edits may have applied. ReadCanvas before retrying.",
                result.response.operations_applied
            )));
        }
        Ok(result.response)
    }

    /// Apply an already planned batch using edit capability; no nested model or model billing.
    #[tracing::instrument(skip_all, fields(document_id = %receipt.entity().entity_id), err)]
    pub async fn apply(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        user: &MacroUserIdStr<'static>,
        actor: Option<&str>,
        request: CanvasRequest,
    ) -> Result<CanvasResponse, CanvasError> {
        let CanvasRequest::Apply {
            expected_revision,
            code,
            snippets,
            ..
        } = &request
        else {
            return Err(CanvasError::Invalid(
                "Expected a direct Canvas SDK batch.".to_owned(),
            ));
        };
        ensure(
            expected_revision.len() == 64
                && expected_revision.bytes().all(|b| b.is_ascii_hexdigit()),
            "Use the immutable revision from a fresh ReadCanvas.",
        )?;
        ensure(
            !code.trim().is_empty() && code.len() <= 50000,
            "Canvas code must contain 1–50000 bytes.",
        )?;
        ensure(
            snippets.as_ref().is_none_or(|values| {
                values.len() <= 100
                    && values
                        .iter()
                        .all(|(key, value)| key.len() <= 200 && value.len() <= 20000)
                    && values.values().map(String::len).sum::<usize>() <= 50000
            }),
            "Canvas snippets exceed the bounded text budget.",
        )?;
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
        if !result.usage.is_empty() {
            return Err(CanvasError::Failed(anyhow::anyhow!(
                "Direct Canvas edits must not invoke a model."
            )));
        }
        if let Some(error) = result.failure {
            return Err(CanvasError::Failed(anyhow::anyhow!(
                "Canvas batch stopped after {} acknowledged operations: {error}. ReadCanvas before retrying; a lost acknowledgement is uncertain.",
                result.response.operations_applied
            )));
        }
        Ok(result.response)
    }

    async fn ensure_canvas(&self, document_id: &str) -> Result<(), CanvasError> {
        let file_type = self
            .documents
            .file_type(document_id)
            .await
            .map_err(CanvasError::Internal)?;
        ensure(
            file_type.as_deref() == Some("canvas"),
            "This tool requires a Macro canvas. Use the matching document tool for other file types.",
        )
    }

    async fn run(
        &self,
        document_id: &str,
        user: &MacroUserIdStr<'static>,
        actor: Option<&str>,
        access: AccessLevel,
        request: CanvasRequest,
    ) -> Result<CanvasResult, CanvasError> {
        let token = encode_permission_token(
            Some(user.to_string()),
            document_id.to_owned(),
            access,
            &self.token_secret,
            actor.map(str::to_owned),
        )
        .map_err(|error| CanvasError::Internal(error.into()))?;
        self.worker
            .canvas(document_id, &token, &request, self.artifacts)
            .await
    }
}

/// Commits document nodes that server-side flows place on canvases. No
/// model runs, so there is no admission or metering.
pub struct CanvasEmbedder<D, W> {
    documents: Arc<D>,
    worker: Arc<W>,
    token_secret: String,
}

impl<D: CanvasDocumentLookup, W: EditingWorkerService> CanvasEmbedder<D, W> {
    /// Construct over the document lookup, the editing worker and the
    /// permission token secret.
    pub fn new(documents: Arc<D>, worker: Arc<W>, token_secret: String) -> Self {
        Self {
            documents,
            worker,
            token_secret,
        }
    }

    /// Commit `embed` to the canvas the receipt grants edit access to, as
    /// `user` acting through `actor`. Repeating it is a no-op.
    #[tracing::instrument(
        skip_all,
        fields(document_id = %receipt.entity().entity_id, embedded_id = %embed.document_id),
        err
    )]
    pub async fn embed_document(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        user: &MacroUserIdStr<'static>,
        actor: Option<&str>,
        embed: CanvasDocumentEmbed,
    ) -> anyhow::Result<()> {
        let document_id = &receipt.entity().entity_id;
        let file_type = self.documents.file_type(document_id).await?;
        anyhow::ensure!(
            file_type.as_deref() == Some("canvas"),
            "Only canvases take embedded documents."
        );
        let token = encode_permission_token(
            Some(user.to_string()),
            document_id.to_owned(),
            AccessLevel::Edit,
            &self.token_secret,
            actor.map(str::to_owned),
        )?;
        self.worker
            .embed_canvas_document(document_id, &token, &embed)
            .await
    }
}

fn ensure(condition: bool, message: &str) -> Result<(), CanvasError> {
    if condition {
        Ok(())
    } else {
        Err(CanvasError::Invalid(message.to_owned()))
    }
}

#[cfg(test)]
mod test;
