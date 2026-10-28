//! Per-link change watermark: how far each email link's server change log has
//! been applied to the cached calendar.

use super::CalendarError;
use serde::{Deserialize, Deserializer, Serialize, Serializer};
use std::collections::{BTreeMap, BTreeSet};

/// Applied change-log position of one email link.
#[derive(Clone, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarLinkWatermark {
    /// Email link id.
    pub link_id: String,
    /// Last applied change-log sequence, sent as a decimal string because it
    /// is a 64-bit server counter.
    #[serde(serialize_with = "serialize_seq", deserialize_with = "deserialize_seq")]
    pub seq: i64,
}

fn serialize_seq<S: Serializer>(seq: &i64, serializer: S) -> Result<S::Ok, S::Error> {
    serializer.serialize_str(&seq.to_string())
}

fn deserialize_seq<'de, D: Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    let value = String::deserialize(deserializer)?;
    value
        .parse::<i64>()
        .ok()
        .filter(|seq| *seq >= 0 && value.bytes().all(|byte| byte.is_ascii_digit()))
        .ok_or_else(|| serde::de::Error::custom("watermark seq must be a non-negative integer"))
}

/// How a commit changes the persisted watermark.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CalendarWatermarkUpdate {
    /// A page read captured `links` before reading its rows. Each link is
    /// lowered to the incoming value, so changes the page may predate are
    /// replayed by the next delta; links without a value adopt it.
    Merge {
        /// Watermark captured by the page.
        links: Vec<CalendarLinkWatermark>,
    },
    /// A delta computed from `since` applied every change up to `to`. A link
    /// still at its `since` value advances to `to`; a link another commit
    /// moved meanwhile keeps the lower of the two values.
    Advance {
        /// Watermark the delta was requested from.
        since: Vec<CalendarLinkWatermark>,
        /// Server watermark the delta reached.
        to: Vec<CalendarLinkWatermark>,
    },
}

impl CalendarWatermarkUpdate {
    /// Number of link entries carried by the update.
    pub fn len(&self) -> usize {
        match self {
            Self::Merge { links } => links.len(),
            Self::Advance { since, to } => since.len() + to.len(),
        }
    }

    /// Whether the update carries no link entries.
    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// Rejects empty or duplicate link ids and negative sequences.
    pub fn validate(&self) -> Result<(), CalendarError> {
        let lists: &[&[CalendarLinkWatermark]] = match self {
            Self::Merge { links } => &[links],
            Self::Advance { since, to } => &[since, to],
        };
        for links in lists {
            let mut seen = BTreeSet::new();
            if links.iter().any(|link| {
                link.link_id.is_empty() || link.seq < 0 || !seen.insert(link.link_id.as_str())
            }) {
                return Err(CalendarError::InvalidWatermark);
            }
        }
        Ok(())
    }
}

/// Applies an update to the stored watermark, then drops removed links.
///
/// A missing stored link places no bound on the incoming value. The result is
/// ordered by link id.
pub fn apply_watermark_update(
    stored: Option<&[CalendarLinkWatermark]>,
    update: Option<&CalendarWatermarkUpdate>,
    removed_link_ids: &[String],
) -> Vec<CalendarLinkWatermark> {
    let mut current = stored
        .unwrap_or_default()
        .iter()
        .map(|link| (link.link_id.clone(), link.seq))
        .collect::<BTreeMap<_, _>>();
    let lower = |current: Option<i64>, incoming: i64| current.map_or(incoming, |c| c.min(incoming));
    match update {
        None => {}
        Some(CalendarWatermarkUpdate::Merge { links }) => {
            for link in links {
                let value = lower(current.get(&link.link_id).copied(), link.seq);
                current.insert(link.link_id.clone(), value);
            }
        }
        Some(CalendarWatermarkUpdate::Advance { since, to }) => {
            let since = since
                .iter()
                .map(|link| (link.link_id.as_str(), link.seq))
                .collect::<BTreeMap<_, _>>();
            for link in to {
                let stored = current.get(&link.link_id).copied();
                let value = if stored == since.get(link.link_id.as_str()).copied() {
                    link.seq
                } else {
                    lower(stored, link.seq)
                };
                current.insert(link.link_id.clone(), value);
            }
        }
    }
    for link_id in removed_link_ids {
        current.remove(link_id);
    }
    current
        .into_iter()
        .map(|(link_id, seq)| CalendarLinkWatermark { link_id, seq })
        .collect()
}

/// Encodes a watermark for persistence.
pub fn serialize_watermark(watermark: &[CalendarLinkWatermark]) -> String {
    serde_json::to_string(watermark).expect("watermark serializes")
}

/// Decodes a persisted watermark.
pub fn parse_watermark(value: &str) -> Option<Vec<CalendarLinkWatermark>> {
    serde_json::from_str(value).ok()
}
