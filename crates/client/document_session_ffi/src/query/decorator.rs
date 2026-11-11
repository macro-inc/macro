//! Attached decorator facts; model helpers remain authoritative for media constraints.
use crate::*;
use macro_document_model::nodes::{ImageNode, JsNumber, Maybe, MediaNode, VideoNode};

/// Immutable native decorator presentation facts.
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
    /// Shared constrained width; NaN when natural dimensions are unavailable.
    pub width: f64,
    /// Shared constrained height; NaN when natural dimensions are unavailable.
    pub height: f64,
    /// Stored model display scale, without native normalization.
    pub scale: f64,
}

/// Decoded natural dimensions used only for a renderer-local layout query.
#[derive(uniffi::Record)]
pub struct FfiMediaMeasurement {
    /// Current attached image or video key.
    pub key: NodeKey,
    /// Positive finite natural width from successful host decoding.
    pub width: f64,
    /// Positive finite natural height from successful host decoding.
    pub height: f64,
}

fn media_layout(node: &impl MediaNode) -> FfiMediaLayout {
    let dimensions = node.effective_dimensions();
    FfiMediaLayout {
        width: dimensions.width,
        height: dimensions.height,
        scale: node.media().scale.0,
    }
}

fn measured_layout<T: MediaNode + Clone>(
    node: &T,
    measurement: &FfiMediaMeasurement,
) -> FfiMediaLayout {
    // Plain data cloning deliberately avoids node-clone hooks and document transactions.
    let mut local = node.clone();
    local.media_mut().width = Maybe::Value(JsNumber(measurement.width));
    local.media_mut().height = Maybe::Value(JsNumber(measurement.height));
    media_layout(&local)
}

pub(super) fn measured_facts(
    state: &EditorState,
    measurements: Vec<FfiMediaMeasurement>,
) -> Result<Vec<FfiDecorator>, FfiSessionError> {
    let mut nodes = facts(state, measurements.iter().map(|item| item.key).collect())?;
    let view = state.view();
    for (node, measurement) in nodes.iter_mut().zip(measurements) {
        if !measurement.width.is_finite()
            || !measurement.height.is_finite()
            || measurement.width <= 0.0
            || measurement.height <= 0.0
        {
            return Err(invalid(
                "media measurements require positive finite dimensions",
            ));
        }
        node.media = Some(
            view.get::<ImageNode>(node.key)
                .map(|image| measured_layout(image, &measurement))
                .or_else(|| {
                    view.get::<VideoNode>(node.key)
                        .map(|video| measured_layout(video, &measurement))
                })
                .ok_or_else(|| invalid("media measurements require an actual image or video"))?,
        );
    }
    Ok(nodes)
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
