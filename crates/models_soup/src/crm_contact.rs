//! Team-owned CRM contacts exposed through Soup.

use chrono::{DateTime, Utc};
use crm::domain::model::CrmContactForSoup;
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
    /// Parent company ID.
    pub company_id: Uuid,
    /// Parent company's display name.
    pub company_name: String,
    /// Full email address.
    pub email: String,
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

impl From<CrmContactForSoup> for SoupCrmContact<()> {
    fn from(value: CrmContactForSoup) -> Self {
        let contact = value.contact;
        Self {
            id: contact.id,
            team_id: value.team_id,
            company_id: contact.company_id,
            company_name: value.company_name,
            email: contact.email,
            name: contact.name,
            hidden: contact.hidden,
            first_interaction: contact.first_interaction,
            last_interaction: contact.last_interaction,
            created_at: contact.created_at,
            updated_at: contact.updated_at,
            viewed_at: value.viewed_at,
            extra: (),
        }
    }
}
