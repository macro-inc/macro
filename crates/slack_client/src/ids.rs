//! Shape-checked Slack identifiers and message timestamps.

use std::fmt;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

/// A Slack id or timestamp that failed its shape check.
#[derive(Debug, thiserror::Error)]
#[error("{kind} has an invalid shape")]
pub struct InvalidId {
    /// Which identifier type rejected the value.
    pub kind: &'static str,
}

// Slack ids are an uppercase type letter followed by uppercase letters and
// digits (`T…`, `U…`/`W…`, `C…`/`G…`/`D…`, `E…`, `F…`, `B…`, and `USLACKBOT`).
macro_rules! slack_id {
    ($(#[$doc:meta])* $name:ident) => {
        $(#[$doc])*
        #[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
        #[serde(try_from = "String", into = "String")]
        pub struct $name(String);

        impl $name {
            /// Validates and wraps an id.
            pub fn new(value: impl Into<String>) -> Result<Self, InvalidId> {
                let value = value.into();
                if lazy_regex::regex_is_match!(r"^[A-Z][A-Z0-9]{1,31}$", &value) {
                    Ok(Self(value))
                } else {
                    Err(InvalidId { kind: stringify!($name) })
                }
            }

            /// The id as Slack writes it.
            pub fn as_str(&self) -> &str {
                &self.0
            }
        }

        impl TryFrom<String> for $name {
            type Error = InvalidId;

            fn try_from(value: String) -> Result<Self, Self::Error> {
                Self::new(value)
            }
        }

        impl From<$name> for String {
            fn from(value: $name) -> String {
                value.0
            }
        }

        impl fmt::Display for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                formatter.write_str(&self.0)
            }
        }

        impl fmt::Debug for $name {
            fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
                fmt::Debug::fmt(&self.0, formatter)
            }
        }
    };
}

slack_id!(
    /// A workspace (`T…`) or, on Enterprise Grid, an org acting as a team (`E…`).
    TeamId
);
slack_id!(
    /// An Enterprise Grid org (`E…`).
    EnterpriseId
);
slack_id!(
    /// A user (`U…` or `W…`), including external Slack Connect users.
    UserId
);
slack_id!(
    /// A conversation: public channel (`C…`), private channel (`G…`), DM (`D…`).
    ChannelId
);
slack_id!(
    /// An uploaded file (`F…`).
    FileId
);
slack_id!(
    /// A bot (`B…`).
    BotId
);
slack_id!(
    /// A Slack app (`A…`).
    AppId
);
slack_id!(
    /// A user group (`S…`).
    UserGroupId
);

/// A message timestamp (`1700000000.000100`), Slack's message id within a
/// channel. Slack always writes six fractional digits and ten integer digits,
/// so string order is time order.
#[derive(Clone, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "String", into = "String")]
pub struct MessageTs(String);

impl MessageTs {
    /// Validates and wraps a timestamp.
    pub fn new(value: impl Into<String>) -> Result<Self, InvalidId> {
        let value = value.into();
        if lazy_regex::regex_is_match!(r"^\d{1,12}\.\d{1,9}$", &value) {
            Ok(Self(value))
        } else {
            Err(InvalidId { kind: "MessageTs" })
        }
    }

    /// The timestamp as Slack writes it.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// The wall-clock time the timestamp encodes, if it is in range.
    pub fn to_datetime(&self) -> Option<DateTime<Utc>> {
        let (seconds, fraction) = self.0.split_once('.')?;
        let seconds: i64 = seconds.parse().ok()?;
        let micros: u32 = format!("{fraction:0<6}").get(..6)?.parse().ok()?;
        DateTime::from_timestamp(seconds, micros * 1000)
    }
}

impl TryFrom<String> for MessageTs {
    type Error = InvalidId;

    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

impl From<MessageTs> for String {
    fn from(value: MessageTs) -> String {
        value.0
    }
}

impl fmt::Display for MessageTs {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(&self.0)
    }
}

impl fmt::Debug for MessageTs {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        fmt::Debug::fmt(&self.0, formatter)
    }
}
