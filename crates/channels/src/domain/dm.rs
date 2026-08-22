//! Direct-message identity and batch commands.

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use std::collections::HashSet;

#[cfg(test)]
mod test;

/// Error returned when both sides of a direct-message pair are the same user.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("a direct message requires two distinct users")]
pub struct SelfDm;

/// The canonical identity of a direct message between two users.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct DmPair {
    lo: MacroUserIdStr<'static>,
    hi: MacroUserIdStr<'static>,
}

impl DmPair {
    /// Construct a canonical pair ordered by UTF-8 byte order.
    pub fn new(a: MacroUserIdStr<'_>, b: MacroUserIdStr<'_>) -> Result<Self, SelfDm> {
        match a.as_ref().cmp(b.as_ref()) {
            std::cmp::Ordering::Less => Ok(Self {
                lo: a.into_owned(),
                hi: b.into_owned(),
            }),
            std::cmp::Ordering::Greater => Ok(Self {
                lo: b.into_owned(),
                hi: a.into_owned(),
            }),
            std::cmp::Ordering::Equal => Err(SelfDm),
        }
    }

    /// Return the lower canonical user id.
    pub fn lo(&self) -> &MacroUserIdStr<'static> {
        &self.lo
    }

    /// Return the higher canonical user id.
    pub fn hi(&self) -> &MacroUserIdStr<'static> {
        &self.hi
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct EnsureDm {
    pub(crate) pair: DmPair,
    pub(crate) owner: MacroUserIdStr<'static>,
}

/// An opaque batch of direct messages to ensure.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EnsureDms {
    requests: Vec<EnsureDm>,
}

impl EnsureDms {
    /// Build the direct-message star for one joining member and a team roster.
    pub fn for_joining_member(
        joiner: MacroUserIdStr<'static>,
        roster: impl IntoIterator<Item = MacroUserIdStr<'static>>,
    ) -> Self {
        let teammates = roster
            .into_iter()
            .filter(|user_id| user_id != &joiner)
            .collect::<HashSet<_>>();
        let mut requests = teammates
            .into_iter()
            .map(|teammate| EnsureDm {
                pair: DmPair::new(joiner.clone(), teammate)
                    .expect("joining member was removed from the roster"),
                owner: joiner.clone(),
            })
            .collect::<Vec<_>>();
        sort_requests(&mut requests);
        Self { requests }
    }

    /// Build the complete direct-message clique for a team roster.
    pub fn for_roster(roster: impl IntoIterator<Item = MacroUserIdStr<'static>>) -> Self {
        let mut roster = roster
            .into_iter()
            .collect::<HashSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        roster.sort_by(|a, b| a.as_ref().cmp(b.as_ref()));

        let mut requests =
            Vec::with_capacity(roster.len().saturating_mul(roster.len().saturating_sub(1)) / 2);
        for (index, lo) in roster.iter().enumerate() {
            for hi in &roster[index + 1..] {
                requests.push(EnsureDm {
                    pair: DmPair::new(lo.clone(), hi.clone()).expect("roster users are distinct"),
                    owner: lo.clone(),
                });
            }
        }
        Self { requests }
    }

    pub(crate) fn into_requests(self) -> Vec<EnsureDm> {
        self.requests
    }
}

fn sort_requests(requests: &mut [EnsureDm]) {
    requests.sort_by(|a, b| {
        a.pair
            .lo()
            .as_ref()
            .cmp(b.pair.lo().as_ref())
            .then_with(|| a.pair.hi().as_ref().cmp(b.pair.hi().as_ref()))
    });
}

/// Counts produced by a direct-message ensure batch.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct EnsureDmsSummary {
    /// Direct-message channels created by the batch.
    pub created: usize,
    /// Direct-message pairs that already had a channel.
    pub existing: usize,
    /// Direct-message pairs that could not be ensured.
    pub failed: usize,
}
