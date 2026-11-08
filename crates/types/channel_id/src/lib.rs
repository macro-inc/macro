//! The id of a Macro channel.

#![deny(missing_docs)]

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[cfg(test)]
mod test;

// The doc comment below is the OpenAPI description clients already see.
/// Channel id for soup channel payloads.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(transparent)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
pub struct ChannelId(pub Uuid);
