//! Native image presentation and guarded callbacks; shared commands own every document mutation.
use super::*;
use macro_document_model::nodes::ImageNode;

/// Dimensions computed by the model's existing pure media constraint helper.
pub type FfiMediaDimensions = macro_document_model::nodes::Dimensions;
#[uniffi::remote(Record)]
struct FfiMediaDimensions {
    width: f64,
    height: f64,
}
/// Compute renderer-local dimensions using captured component constraints, without reading a session.
#[uniffi::export]
pub fn media_display_dimensions(
    width: f64,
    height: f64,
    constrained_width: Option<f64>,
    constrained_height: Option<f64>,
) -> FfiMediaDimensions {
    macro_document_model::nodes::calculate_effective_dimensions(
        width,
        height,
        constrained_width,
        constrained_height,
    )
}
/// Native image controls; execution remains a normal shared model command.
#[derive(uniffi::Enum)]
pub enum FfiImageEdit {
    /// Delete the current image and restore its model selection.
    Delete,
    /// Persist the renderer's scale without starting a new component lifetime.
    Scale {
        /// Actual user-selected scale.
        value: f64,
    },
}
fn current_image(
    host: &NativeHost<EditorSurface>,
    lease: u64,
    key: NodeKey,
    revision: u64,
) -> Result<(), FfiSessionError> {
    host.decorator_view
        .validate_revision(lease, key, revision)?;
    let state = host.session.surface().state();
    let view = state.view();
    if !view.is_attached(key)
        || view
            .get::<ImageNode>(key)
            .is_none_or(|node| node.render_revision != revision)
    {
        return Err(invalid("image component changed"));
    }
    Ok(())
}
fn image_command(
    host: &mut NativeHost<EditorSurface>,
    now: FfiNow,
    key: NodeKey,
    name: &str,
    payload: serde_json::Value,
) -> Result<FfiOutput, FfiSessionError> {
    if host.application.is_none() {
        return Err(invalid("image actions require an application preset"));
    }
    let command = macro_document_model::surface::decode_command(
        name,
        &payload.to_string(),
        key.generation(),
        None,
    )
    .map_err(invalid)?
    .ok_or_else(|| invalid("image command is unavailable"))?;
    host.handle_native(
        now,
        SessionInput::Editor(Input::Command {
            command,
            selection: ViewSelection::KeepModel,
        }),
    )
}
#[uniffi::export]
impl NativeEditorSession {
    /// Apply decoded natural dimensions only under current SessionEdit authority.
    /// Read and Comment return no output and make no clock, model, WAL or IO change.
    /// Local editor/UI locks do not override this session authority.
    pub fn normalize_image_size(
        &self,
        now: FfiNow,
        lease: u64,
        key: NodeKey,
        revision: u64,
        width: f64,
        height: f64,
    ) -> Result<Option<FfiOutput>, FfiSessionError> {
        if !width.is_finite() || !height.is_finite() || width <= 0.0 || height <= 0.0 {
            return Err(invalid(
                "decoded image dimensions require positive finite values",
            ));
        }
        let mut host = lock(&self.inner)?;
        current_image(&host, lease, key, revision)?;
        if host.session.effective_access() != Access::Edit {
            return Ok(None);
        }
        image_command(
            &mut host,
            now,
            key,
            "group-b.media-resize",
            serde_json::json!({"key":key.index(),"kind":"image","width":width,"height":height}),
        )
        .map(Some)
    }
    /// Preserve the source's historic DSS URL upgrade only under current edit authority.
    pub fn resolve_image_url(
        &self,
        now: FfiNow,
        lease: u64,
        key: NodeKey,
        revision: u64,
        url: String,
    ) -> Result<Option<FfiOutput>, FfiSessionError> {
        let mut host = lock(&self.inner)?;
        current_image(&host, lease, key, revision)?;
        if host.session.effective_access() != Access::Edit {
            return Ok(None);
        }
        image_command(
            &mut host,
            now,
            key,
            "group-b.media-upgrade-url",
            serde_json::json!({"key":key.index(),"kind":"image","url":url}),
        )
        .map(Some)
    }
    /// Revalidate the consumed image lifetime before normal shared command admission.
    pub fn image_edit(
        &self,
        now: FfiNow,
        lease: u64,
        key: NodeKey,
        revision: u64,
        edit: FfiImageEdit,
    ) -> Result<FfiOutput, FfiSessionError> {
        let mut host = lock(&self.inner)?;
        current_image(&host, lease, key, revision)?;
        if let FfiImageEdit::Scale { value } = &edit
            && !value.is_finite()
        {
            return Err(invalid("image scale requires a finite value"));
        }
        let (name, payload) = match edit {
            FfiImageEdit::Delete => (
                "group-b.media",
                serde_json::json!({"action":"delete","key":key.index()}),
            ),
            FfiImageEdit::Scale { value } => (
                "group-b.media-set-property",
                serde_json::json!({"key":key.index(),"kind":"image","property":"scale","value":value,"rerender":false}),
            ),
        };
        image_command(&mut host, now, key, name, payload)
    }
}

#[cfg(test)]
mod test;
