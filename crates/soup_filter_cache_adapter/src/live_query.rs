//! Optional maintained-view request shared by browser and native adapters.

use serde::Deserialize;

/// Selects a maintained fragment projection of a reconciled Soup query.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiveQueryRequest {
    /// Subscriber-owned identity; distinct subscribers use distinct ids.
    pub id: String,
    /// Fragment document containing the selected row fields.
    pub document: String,
    /// Root fragment within the document.
    pub fragment_name: String,
    /// Last revision accepted by this subscriber, within this engine generation.
    pub since: Option<String>,
    /// Release the retained view when its subscription ends.
    #[serde(default)]
    pub release: bool,
    /// The row each update carries (`channel-list`), or the selected record.
    /// Only hosts that advertise row shapes accept it; an older host refuses
    /// the unknown field.
    #[serde(default)]
    pub row: Option<String>,
}
