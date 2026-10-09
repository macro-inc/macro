//! Filters for opt-in CRM contact listings.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A predicate over one team-owned contact, evaluated before deduplication.
#[derive(Debug, Serialize, Deserialize, Clone)]
pub enum CrmContactLiteral {
    /// Include visible contacts without narrowing their fields.
    #[serde(rename = "include")]
    Include,
    /// Retrieve an exact team record. ID-only queries preserve every requested ID.
    #[serde(rename = "id")]
    Id(Uuid),
    /// Restrict contacts to a company the viewer can access.
    #[serde(rename = "company_id")]
    CompanyId(Uuid),
    /// Restrict contacts to a team the viewer belongs to.
    #[serde(rename = "team_id")]
    TeamId(Uuid),
    /// Match a full email address, case-insensitively.
    #[serde(rename = "email")]
    Email(String),
    /// Match literal text within the contact's name or email.
    #[serde(rename = "search")]
    Search(String),
    /// Match effective visibility (the contact or its company is hidden).
    /// Hidden rows remain available only to that team's admins and owners.
    #[serde(rename = "hidden")]
    Hidden(bool),
}
