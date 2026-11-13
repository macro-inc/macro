use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A team, listed only by attention feeds: team-scoped notifications (a
/// vault access request) are filed under it, and it has no page of its own.
/// Teams carry no timestamps; attention feeds order by attention time.
#[derive(Serialize, Clone, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct SoupTeam {
    /// The team uuid.
    pub id: Uuid,

    /// The team's display name.
    pub name: String,

    /// The user who owns the team.
    pub owner_id: String,
}
