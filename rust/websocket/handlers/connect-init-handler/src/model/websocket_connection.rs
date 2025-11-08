use chrono::{serde::ts_seconds_option, DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct WebsocketConnectionSubmission<'a> {
    /// The connection id of the websocket
    pub connection_id: Cow<'a, str>,
    /// The user id associated with the connection if there is one
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<Cow<'a, str>>,
    /// The email associated with the connection if there is one
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<Cow<'a, str>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(with = "ts_seconds_option")]
    pub expires_at_seconds: Option<DateTime<Utc>>,
}
