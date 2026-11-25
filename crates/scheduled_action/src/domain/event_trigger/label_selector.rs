//! Which email labels an `email.labeled` routine watches.

use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};

const MAX_LABELS: usize = 100;

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("expected between 1 and 100 labels")]
pub struct LabelCountError;

/// The labels a thread must gain one of, by their row ids. A label belongs to
/// one inbox, so two inboxes' labels of the same name never match each other.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(try_from = "Vec<Uuid>", into = "Vec<Uuid>")]
pub struct LabelSelector(Vec<Uuid>);

impl TryFrom<Vec<Uuid>> for LabelSelector {
    type Error = LabelCountError;

    fn try_from(mut labels: Vec<Uuid>) -> Result<Self, Self::Error> {
        if labels.is_empty() || labels.len() > MAX_LABELS {
            return Err(LabelCountError);
        }
        labels.sort_unstable();
        labels.dedup();
        Ok(Self(labels))
    }
}

impl From<LabelSelector> for Vec<Uuid> {
    fn from(selector: LabelSelector) -> Self {
        selector.0
    }
}

impl LabelSelector {
    pub fn labels(&self) -> &[Uuid] {
        &self.0
    }

    pub(super) fn accepts(&self, gained: &[Uuid]) -> bool {
        gained.iter().any(|label| self.0.contains(label))
    }
}
