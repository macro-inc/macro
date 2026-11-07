//! Media construction and JavaScript-compatible dimension constraints.
use super::*;
/// Media class used by serialized guards.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MediaType {
    /// Still image.
    Image,
    /// Video clip.
    Video,
}
/// Width and height in display pixels.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Dimensions {
    /// Display width.
    pub width: f64,
    /// Display height.
    pub height: f64,
}
/// Common payload projection for the two media classes.
pub trait MediaNode: DecoratorBlock {
    /// Class of media.
    const MEDIA_TYPE: MediaType;
    /// Read stored media properties.
    fn media(&self) -> &MediaData;
    /// Write stored media properties.
    fn media_mut(&mut self) -> &mut MediaData;
    /// Apply constraints without scaling up; missing dimensions participate as JS NaN/null.
    fn effective_dimensions(&self) -> Dimensions {
        let data = self.media();
        calculate_effective_dimensions(
            number(&data.width),
            number(&data.height),
            optional_number(&data.constrained_width),
            optional_number(&data.constrained_height),
        )
    }
}
fn number(value: &Maybe<JsNumber>) -> f64 {
    match value {
        Maybe::Missing => f64::NAN,
        Maybe::Null => 0.0,
        Maybe::Value(v) => v.0,
    }
}
fn optional_number(value: &Maybe<JsNumber>) -> Option<f64> {
    match value {
        Maybe::Missing | Maybe::Null => None,
        Maybe::Value(v) => Some(v.0),
    }
}
impl MediaNode for ImageNode {
    const MEDIA_TYPE: MediaType = MediaType::Image;
    fn media(&self) -> &MediaData {
        &self.media
    }
    fn media_mut(&mut self) -> &mut MediaData {
        &mut self.media
    }
}
impl MediaNode for VideoNode {
    const MEDIA_TYPE: MediaType = MediaType::Video;
    fn media(&self) -> &MediaData {
        &self.media
    }
    fn media_mut(&mut self) -> &mut MediaData {
        &mut self.media
    }
}
fn truthy_number(value: f64) -> bool {
    value != 0.0 && !value.is_nan()
}
/// Fit within the given nonzero constraints, preserving aspect ratio and JS Math.round.
pub fn calculate_effective_dimensions(
    width: f64,
    height: f64,
    constrained_width: Option<f64>,
    constrained_height: Option<f64>,
) -> Dimensions {
    let original = Dimensions { width, height };
    let cw = constrained_width.filter(|v| truthy_number(*v));
    let ch = constrained_height.filter(|v| truthy_number(*v));
    if (cw.is_none() && ch.is_none()) || width <= 0.0 || height <= 0.0 {
        return original;
    }
    let ws = cw.map_or(f64::INFINITY, |v| v / width);
    let hs = ch.map_or(f64::INFINITY, |v| v / height);
    let scale = if ws.is_nan() || hs.is_nan() {
        f64::NAN
    } else {
        ws.min(hs)
    };
    if scale == f64::INFINITY || scale >= 1.0 {
        original
    } else {
        Dimensions {
            width: js_round(width * scale),
            height: js_round(height * scale),
        }
    }
}
fn js_round(value: f64) -> f64 {
    if !value.is_finite() || value == 0.0 {
        return value;
    }
    if (-0.5..0.0).contains(&value) {
        return -0.0;
    }
    let floor = value.floor();
    if value - floor < 0.5 {
        floor
    } else {
        floor + 1.0
    }
}
/// A source dimension that may include a unit suffix.
pub enum LooseDimension<'a> {
    /// Parsed using Number.parseInt(value, 10).
    Str(&'a str),
    /// Already numeric.
    Num(f64),
}
fn parse_dimension(value: LooseDimension<'_>) -> f64 {
    match value {
        LooseDimension::Num(value) => value,
        LooseDimension::Str(value) => {
            use nom::{
                Parser,
                character::complete::{digit1, one_of},
                combinator::{opt, recognize},
            };
            let text = value.trim_start_matches(is_js_whitespace);
            let parsed: nom::IResult<&str, &str> =
                recognize((opt(one_of("+-")), digit1)).parse(text);
            parsed
                .ok()
                .and_then(|(_, number)| number.parse().ok())
                .unwrap_or(f64::NAN)
        }
    }
}
/// Parse positive dimensions and constrain them; missing, zero and invalid input fail.
pub fn constrain_image_dimensions(
    width: Option<LooseDimension<'_>>,
    height: Option<LooseDimension<'_>>,
    max_width: Option<f64>,
    max_height: Option<f64>,
) -> Option<Dimensions> {
    let width = parse_dimension(width?);
    let height = parse_dimension(height?);
    if !truthy_number(width) || !truthy_number(height) || width <= 0.0 || height <= 0.0 {
        return None;
    }
    Some(calculate_effective_dimensions(
        width, height, max_width, max_height,
    ))
}
/// Constructor inputs before MediaNode's nullish defaults.
#[derive(Clone, Debug, Default)]
pub struct CreateMedia {
    /// Source transport.
    pub src_type: String,
    /// Storage identifier.
    pub id: Option<String>,
    /// Source URL.
    pub url: Option<String>,
    /// Source width.
    pub width: Option<f64>,
    /// Source height.
    pub height: Option<f64>,
    /// Maximum width.
    pub constrained_width: Option<f64>,
    /// Maximum height.
    pub constrained_height: Option<f64>,
    /// Display scale.
    pub scale: Option<f64>,
}
impl From<CreateMedia> for MediaData {
    fn from(value: CreateMedia) -> Self {
        Self {
            src_type: Maybe::Value(value.src_type),
            id: Maybe::Value(value.id.unwrap_or_default()),
            url: Maybe::Value(value.url.unwrap_or_default()),
            width: Maybe::Value(JsNumber(value.width.unwrap_or(0.0))),
            height: Maybe::Value(JsNumber(value.height.unwrap_or(0.0))),
            scale: JsNumber(value.scale.filter(|v| truthy_number(*v)).unwrap_or(1.0)),
            constrained_width: Maybe::from_option(value.constrained_width.map(JsNumber)),
            constrained_height: Maybe::from_option(value.constrained_height.map(JsNumber)),
        }
    }
}
/// Create an image with authored defaults, without applying import's lossy defaults.
pub fn create_image_node(
    tx: &mut Transaction<'_>,
    media: CreateMedia,
    alt: Option<String>,
) -> crate::Result<Id<ImageNode>> {
    tx.create(ImageNode {
        media: media.into(),
        alt: alt.unwrap_or_default(),
        ..Default::default()
    })
}
/// Create a video; controls default to enabled.
pub fn create_video_node(
    tx: &mut Transaction<'_>,
    media: CreateMedia,
    controls: Option<bool>,
) -> crate::Result<Id<VideoNode>> {
    tx.create(VideoNode {
        media: media.into(),
        controls: controls.unwrap_or(true),
        ..Default::default()
    })
}
/// Match the serialized type field only, like the source's media guards.
pub fn is_serialized_media_node(node: &Value, media_type: MediaType) -> bool {
    node.get("type").and_then(Value::as_str)
        == Some(match media_type {
            MediaType::Image => "image",
            MediaType::Video => "video",
        })
}
/// Match an image payload's type field.
pub fn is_serialized_image_node(node: &Value) -> bool {
    is_serialized_media_node(node, MediaType::Image)
}
/// Match a video payload's type field.
pub fn is_serialized_video_node(node: &Value) -> bool {
    is_serialized_media_node(node, MediaType::Video)
}
