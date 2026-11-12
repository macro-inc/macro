//! Team-owned CRM contacts exposed through Soup.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// One original CRM contact record, selected from the viewer's accessible teams.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SoupCrmContact<T = ()> {
    /// Original team-owned contact ID.
    pub id: Uuid,
    /// Team owning this record.
    pub team_id: Uuid,
    /// Parent company ID; `None` for a contact without a company.
    pub company_id: Option<Uuid>,
    /// Parent company's display name; `None` without a company.
    pub company_name: Option<String>,
    /// Full email address; `None` for a contact added by name alone.
    pub email: Option<String>,
    /// Team-local display name, if known.
    pub name: Option<String>,
    /// Whether the contact or parent company is hidden.
    pub hidden: bool,
    /// Earliest interaction for this team record.
    pub first_interaction: DateTime<Utc>,
    /// Latest interaction for this team record.
    pub last_interaction: DateTime<Utc>,
    /// Record creation time.
    pub created_at: DateTime<Utc>,
    /// Record update time.
    pub updated_at: DateTime<Utc>,
    /// The viewer's latest visit to this record.
    pub viewed_at: Option<DateTime<Utc>>,
    /// Extra fields supplied by Soup.
    #[serde(flatten)]
    pub extra: T,
}
