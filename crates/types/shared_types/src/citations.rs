use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct DocumentTextPart {
    pub id: String,
    pub document_id: String,
    pub reference: DocumentReference,
}

#[derive(Debug, Serialize, Clone)]
pub struct TextReference {
    pub id: String,
    pub reference: DocumentReference,
}

/// UserPdfRect is in UserSpace
/// (0,0) top left
/// percent page units
/// 1-based page index
#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
pub struct UserPdfRect {
    pub page_index: u32,
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Serialize, Deserialize, Clone, ToSchema)]
#[serde(tag = "kind")]
pub enum DocumentReference {
    #[serde(rename = "pdf")]
    Pdf(UserPdfRect),
}
