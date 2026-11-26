//! Salesforce's JSON shapes, kept to the fields an import reads.

use serde::Deserialize;

/// One page of a SOQL query.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct QueryPage {
    /// Required with `records`: a page without them is not an empty page.
    pub total_size: u64,
    pub done: bool,
    pub next_records_url: Option<String>,
    pub records: Vec<serde_json::Value>,
}

#[derive(Debug, Deserialize)]
pub(super) struct WireUserInfo {
    pub organization_id: String,
    #[serde(default)]
    pub urls: WireUrls,
}

#[derive(Debug, Default, Deserialize)]
pub(super) struct WireUrls {
    pub custom_domain: Option<String>,
    pub rest: Option<String>,
    pub profile: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct WireOrganization {
    pub default_currency_iso_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct WireUser {
    pub id: String,
    pub email: Option<String>,
    pub is_active: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct WireStage {
    pub api_name: String,
    pub master_label: String,
    pub sort_order: Option<i32>,
    pub is_closed: bool,
    pub is_won: bool,
    /// A percent, 0 to 100.
    pub default_probability: Option<f64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct WireAccount {
    pub id: String,
    pub name: Option<String>,
    pub website: Option<String>,
    pub owner_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct WireContact {
    pub id: String,
    pub first_name: Option<String>,
    pub last_name: Option<String>,
    pub email: Option<String>,
    pub account_id: Option<String>,
    pub owner_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub(super) struct WireOpportunity {
    pub id: String,
    pub name: Option<String>,
    pub stage_name: Option<String>,
    pub amount: Option<f64>,
    pub close_date: Option<String>,
    pub account_id: Option<String>,
    pub owner_id: Option<String>,
    pub is_closed: bool,
    pub is_won: bool,
    /// Absent in single-currency orgs.
    pub currency_iso_code: Option<String>,
}
