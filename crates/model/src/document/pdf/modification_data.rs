use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use crate::annotations::HighlightType;

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct PdfModificationData {
    pub highlights: Option<HashMap<u32, Vec<Highlight>>>, // page_num -> highlights
    #[serde(skip)]
    pub bookmarks: Vec<Value>,
    #[serde(default)]
    pub placeables: Vec<Placeable>,
    #[serde(skip)]
    pub pinned_terms_names: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Placeable {
    pub allowable_edits: AllowableEdits,
    pub was_edited: bool,
    pub was_deleted: bool,
    pub page_range: Vec<i32>,
    pub position: PlaceablePosition,
    pub should_lock_on_save: bool,
    pub original_page: i32,
    pub original_index: i32, // -1 for new
    #[serde(flatten)]
    pub payload: Payload,
}

pub struct ThreadPlaceable {
    pub allowable_edits: AllowableEdits,
    pub was_edited: bool,
    pub was_deleted: bool,
    pub position: PlaceablePosition,
    pub should_lock_on_save: bool,
    pub original_page: i32,
    pub original_index: i32,
    pub head_id: String,
    pub page: i32,
    pub comments: Vec<Comment>,
    pub is_resolved: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AllowableEdits {
    pub allow_resize: bool,
    pub allow_translate: bool,
    pub allow_rotate: bool,
    pub allow_delete: bool,
    pub lock_aspect_ratio: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PlaceablePosition {
    pub x_pct: f64,
    pub y_pct: f64,
    pub width_pct: f64,
    pub height_pct: f64,
    pub rotation: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(tag = "payloadType", content = "payload")]
#[serde(rename_all = "kebab-case")]
pub enum Payload {
    Thread(Thread),
    TextBox(Value),
    Shape(Value),
    FreeTextAnnotation(Value),
    ShapeAnnotation(Value),
    Image(Value),
    Bookmark(Value),
    FreeComment(Value),
    PageNumber(Value),
    Signature(Value),
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    #[serde(rename = "headID")]
    pub head_id: String,
    pub page: i32,
    pub comments: Vec<Comment>,
    pub is_resolved: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Comment {
    pub sender: String,
    pub content: String,
    pub id: String,
    pub edit_date: DateTime<Utc>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub page_num: u32,
    pub rects: Vec<HighlightRect>,
    pub color: Color,
    #[serde(rename = "type")]
    pub highlight_type: HighlightType,
    pub thread: Option<Thread>,
    pub text: String,
    pub page_viewport: Option<WH>,
    pub has_temp_thread: Option<bool>,
    pub uuid: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct HighlightRect {
    pub top: f64,
    pub left: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WH {
    pub width: f64,
    pub height: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Color {
    pub red: i32,
    pub green: i32,
    pub blue: i32,
    pub alpha: Option<f64>,
}
