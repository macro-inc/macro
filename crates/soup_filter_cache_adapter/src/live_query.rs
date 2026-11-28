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
    /// The row each update carries, or the selected record. Only hosts that
    /// advertise row shapes accept it; an older host refuses the unknown
    /// field, and a name this host lacks fails the request.
    #[serde(default)]
    pub row: Option<LiveRowName>,
}

/// A live-view row shape a request can name.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
pub enum LiveRowName {
    /// What the Chat sidebar's channel lists show (`channel_list_row`).
    #[serde(rename = "channel-list")]
    ChannelList,
}

impl LiveRowName {
    /// The name on the wire, for spans.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::ChannelList => crate::channel_list_row::CHANNEL_LIST_ROW,
        }
    }
}
