//! Attached decorator facts; model helpers remain authoritative for media constraints.
use crate::*;
use macro_document_model::nodes::{ImageNode, MediaNode, VideoNode};

/// Immutable model facts for native decorator presentation.
#[derive(uniffi::Record)]
pub struct FfiDecorator {
    /// Generation-aware model key.
    pub key: NodeKey,
    /// Model text content; application display lookups remain host-owned.
    pub text: String,
    /// Instance-specific inline layout.
    pub is_inline: bool,
    /// Instance-specific keyboard selection behavior.
    pub is_keyboard_selectable: bool,
    /// Shared media constraints and scale, only for actual image/video nodes.
    pub media: Option<FfiMediaLayout>,
}
/// Shared media dimensions in CSS pixels, before applying display scale.
#[derive(Debug, uniffi::Record)]
pub struct FfiMediaLayout {
    /// Shared constrained width; missing model dimensions remain NaN.
    pub width: f64,
    /// Shared constrained height; missing model dimensions remain NaN.
    pub height: f64,
    /// Stored model display scale, without native normalization.
    pub scale: f64,
}

fn media_layout(node: &impl MediaNode) -> FfiMediaLayout {
    let dimensions = node.effective_dimensions();
    FfiMediaLayout {
        width: dimensions.width,
        height: dimensions.height,
        scale: node.media().scale.0,
    }
}

pub(super) fn facts(
    state: &EditorState,
    keys: Vec<NodeKey>,
) -> Result<Vec<FfiDecorator>, FfiSessionError> {
    let view = state.view();
    keys.into_iter()
        .map(|key| {
            if view.kind(key) != Some(NodeKind::Decorator) || !view.is_attached(key) {
                return Err(invalid(
                    "decorator query requires a current attached decorator",
                ));
            }
            let media = view
                .get::<ImageNode>(key)
                .map(media_layout)
                .or_else(|| view.get::<VideoNode>(key).map(media_layout));
            Ok(FfiDecorator {
                key,
                text: view.text_content(key).into_owned(),
                is_inline: view.is_inline(key),
                is_keyboard_selectable: view.is_keyboard_selectable(key),
                media,
            })
        })
        .collect()
}
