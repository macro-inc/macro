//! HubSpot's JSON shapes, kept to the fields an import reads.

use std::collections::HashMap;

use serde::{Deserialize, Deserializer};

#[derive(Debug, Deserialize)]
pub(super) struct Page<T> {
    #[serde(default = "Vec::new")]
    pub results: Vec<T>,
    pub paging: Option<Paging>,
}

#[derive(Debug, Deserialize)]
pub(super) struct Paging {
    pub next: Option<Next>,
}

#[derive(Debug, Deserialize)]
pub(super) struct Next {
    pub after: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireAccount {
    pub portal_id: u64,
    pub company_currency: Option<String>,
    pub ui_domain: Option<String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct WireOwner {
    pub id: String,
    pub email: Option<String>,
    #[serde(default)]
    pub archived: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WirePipeline {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub display_order: i64,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub stages: Vec<WireStage>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireStage {
    pub id: String,
    pub label: String,
    #[serde(default)]
    pub display_order: i64,
    #[serde(default)]
    pub archived: bool,
    #[serde(default)]
    pub metadata: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
pub(super) struct WireObject {
    pub id: String,
    #[serde(default)]
    pub properties: HashMap<String, Option<String>>,
    #[serde(default)]
    pub associations: HashMap<String, Page<WireInlineLink>>,
}

/// A v3 inline association: `type` is e.g. `contact_to_company` (primary)
/// or `contact_to_company_unlabeled`.
#[derive(Debug, Deserialize)]
pub(super) struct WireInlineLink {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireLink {
    #[serde(deserialize_with = "number_or_string")]
    pub to_object_id: String,
    #[serde(default)]
    pub association_types: Vec<WireLinkType>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireLinkType {
    pub category: String,
    pub type_id: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WireProperty {
    pub name: String,
    #[serde(default)]
    pub hubspot_defined: bool,
}

fn number_or_string<'de, D: Deserializer<'de>>(deserializer: D) -> Result<String, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Id {
        Number(u64),
        Text(String),
    }
    Ok(match Id::deserialize(deserializer)? {
        Id::Number(number) => number.to_string(),
        Id::Text(text) => text,
    })
}
