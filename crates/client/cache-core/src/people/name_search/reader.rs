//! Bounded name-policy collector shared by indexed storage and the reference scan.
use super::{NameSearch, NameStage, RecentKey, contact_lists};
use crate::{
    people::{
        CONTEXT_FIELD, MAX_LIST_GROUPS, MAX_LIST_KEY_BYTES, MAX_LIST_KEYS, MAX_PEOPLE_BATCH,
        PeopleError, PeopleMode, PeopleSearch, PeopleSearchResult, PersonFacts, PersonHit,
        StoredFacts,
    },
    value::{CacheValue, EntityKey, Record},
};
use macro_user_id::{cowlike::CowLike, email::ReadEmailParts, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use subsequence_match::{normalize_text, ranking::is_automated_recipient_local_part};
use uuid::Uuid;

/// Bound query planning as well as raw text.
pub const MAX_QUERY_WORDS: usize = 32;

/// Engine-local read admission: membership/owner replacement and committed
/// context changes (including patches within one publication epoch).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PeopleReadVersion {
    /// Existing contact admission token, also unique to the live engine owner.
    pub contacts: Uuid,
    /// Committed context token, unaffected by unrelated cache writes.
    pub context: Uuid,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Continuation {
    fingerprint: String,
    priority: u8,
    group: u8,
    timestamp: i64,
    user: String,
}

struct Evaluated<'a> {
    user: MacroUserIdStr<'a>,
    name: &'a str,
    email: &'a str,
    facts: PersonFacts,
    priority: u8,
    group: u8,
    timestamp: i64,
}

/// A winner and its list group. The group orders the window but is not part of
/// the transport hit.
struct Winner {
    hit: PersonHit,
    group: u8,
}

/// Where an ordered rank scan over one stage and list group starts, given the
/// continuation. Rows a scan skips all rank on or before the continuation.
#[derive(Debug, PartialEq, Eq)]
pub enum ScanStart {
    /// Every row of the scan was already emitted.
    Skip,
    /// From the first rank key.
    First,
    /// After this exclusive rank key.
    After(Vec<u8>),
}
fn text<'a>(record: &'a Record, field: &str) -> Option<&'a str> {
    match record.fields.get(field) {
        Some(CacheValue::String(value)) => Some(value),
        _ => None,
    }
}
/// How close the viewer is to a person, closest last.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Closeness {
    Other,
    /// On the viewer's team, never messaged.
    Teammate,
    /// A positive interaction time. The frontend publishes it from
    /// direct-message channels: the first other participant of each, including
    /// group and never-written DMs.
    Messaged,
}
/// Among names matching at a word start, people the viewer messages rank above
/// teammates they never messaged, and both above everyone else, however exactly
/// a stranger's name matches; the name tier then orders each group.
/// Contains-only matches stay below all of them, split into the same groups,
/// and address-only matches below those.
fn priority(stage: NameStage, closeness: Closeness) -> u8 {
    match (stage, closeness) {
        // Browse answers only an empty query and Address only a nonempty one,
        // so they never meet in one search and can share the lowest rank.
        (NameStage::Browse | NameStage::Address, _) => 0,
        (NameStage::Contains, Closeness::Other) => 1,
        (NameStage::Contains, Closeness::Teammate) => 2,
        (NameStage::Contains, Closeness::Messaged) => 3,
        (NameStage::WordPrefix, Closeness::Other) => 4,
        (NameStage::ExactName, Closeness::Other) => 5,
        (NameStage::WordPrefix, Closeness::Teammate) => 6,
        (NameStage::ExactName, Closeness::Teammate) => 7,
        (NameStage::WordPrefix, Closeness::Messaged) => 8,
        (NameStage::ExactName, Closeness::Messaged) => 9,
        (NameStage::EmailPrefix, _) => 10,
        (NameStage::Identity, _) => 11,
    }
}
fn in_stage(stage: NameStage, priority: u8) -> bool {
    [Closeness::Other, Closeness::Teammate, Closeness::Messaged]
        .into_iter()
        .any(|closeness| priority == self::priority(stage, closeness))
}
const SELF_PRIORITY: u8 = 12;
/// Window order: tier and list group, then recency, then identity. Less is earlier.
fn compare(listed: bool, a: &Winner, b: &Winner) -> std::cmp::Ordering {
    tier_order(listed, a.hit.match_rank, a.group, b.hit.match_rank, b.group)
        .then_with(|| b.hit.timestamp_ms.cmp(&a.hit.timestamp_ms))
        .then_with(|| a.hit.user_id.as_ref().cmp(b.hit.user_id.as_ref()))
}
/// Whether tier and group `(priority, group)` precede `(other_priority, other_group)`.
/// With a list order (`listed`), people the text names (exact and word-start
/// matches) rank by list group before name tier, as people without one rank by
/// closeness before name tier. Every other tier comes whole, its groups within it.
fn tier_order(
    listed: bool,
    priority: u8,
    group: u8,
    other_priority: u8,
    other_group: u8,
) -> std::cmp::Ordering {
    let named = |rank: u8| {
        if listed && rank == self::priority(NameStage::WordPrefix, Closeness::Other) {
            self::priority(NameStage::ExactName, Closeness::Other)
        } else {
            rank
        }
    };
    named(other_priority)
        .cmp(&named(priority))
        .then_with(|| group.cmp(&other_group))
        .then_with(|| other_priority.cmp(&priority))
}

/// Caller-owned, query-scoped top-K state. Storage may visit duplicates or run a
/// bounded ordered probe followed by a complete matching scan; never retain history.
pub struct NameSearchRead<'a> {
    request: &'a PeopleSearch,
    epoch: Uuid,
    query: NameSearch,
    namespace: Uuid,
    fingerprint: String,
    after: Option<Continuation>,
    excluded: HashSet<&'a str>,
    teammates: HashSet<&'a str>,
    best: Vec<Winner>,
    users: HashSet<String>,
    conversations: HashSet<Uuid>,
    prior: HashSet<Uuid>,
}
impl<'a> NameSearchRead<'a> {
    /// Validate bounds and bind continuations before any storage access.
    pub fn new(
        request: &'a PeopleSearch,
        epoch: Uuid,
        version: PeopleReadVersion,
    ) -> Result<Self, PeopleError> {
        if request.limit == 0
            || request.limit > MAX_PEOPLE_BATCH
            || request.excluded.len() > MAX_PEOPLE_BATCH
            || request.excluded.iter().any(|id| id.as_ref().len() > 1024)
            || request
                .sender_domain
                .as_ref()
                .is_some_and(|v| v.len() > 255)
            || request.teammates.len() > MAX_PEOPLE_BATCH
            || request.teammates.iter().any(|id| id.as_ref().len() > 1024)
        {
            return Err(PeopleError::InvalidInput);
        }
        if request.list_priority.len() > MAX_LIST_GROUPS
            || request.list_priority.iter().map(Vec::len).sum::<usize>() > MAX_LIST_KEYS
            || request
                .list_priority
                .iter()
                .flatten()
                .any(|key| key.is_empty() || key.len() > MAX_LIST_KEY_BYTES)
        {
            return Err(PeopleError::InvalidInput);
        }
        let query = NameSearch::new(&request.query)?;
        if matches!(&query, NameSearch::Name(q) if q.words().count()>MAX_QUERY_WORDS) {
            return Err(PeopleError::InvalidInput);
        }
        let fingerprint = format!(
            "{:x}",
            Sha256::digest(serde_json::to_vec(&(
                crate::people::PEOPLE_POLICY_VERSION,
                crate::people::sql::projection::VERSION,
                &request.scope,
                epoch,
                version.contacts,
                version.context,
                request.mode,
                &request.query,
                &request.excluded,
                &request.sender_domain,
                &request.list_priority,
                request.only_listed,
                &request.teammates
            ))?)
        );
        let after = if let Some(value) = &request.cursor {
            if value.len() > 4096 {
                return Err(PeopleError::StaleCursor);
            }
            let after: Continuation =
                serde_json::from_str(value).map_err(|_| PeopleError::StaleCursor)?;
            if after.fingerprint != fingerprint
                || after.priority > SELF_PRIORITY
                || usize::from(after.group) > request.list_priority.len()
                || after.user.len() > 1024
                || !MacroUserIdStr::parse_from_str(&after.user)
                    .is_ok_and(|user| user.as_ref() == after.user)
            {
                return Err(PeopleError::StaleCursor);
            }
            Some(after)
        } else {
            None
        };
        Ok(Self {
            request,
            epoch,
            query,
            namespace: Uuid::new_v5(&Uuid::NAMESPACE_OID, request.scope.identity.as_bytes()),
            fingerprint,
            after,
            excluded: request.excluded.iter().map(|id| id.as_ref()).collect(),
            teammates: request.teammates.iter().map(|id| id.as_ref()).collect(),
            best: Vec::with_capacity(request.limit + 1),
            users: HashSet::new(),
            conversations: HashSet::new(),
            prior: HashSet::new(),
        })
    }
    /// Scope/request values already validated by the engine and constructor.
    pub fn request(&self) -> &PeopleSearch {
        self.request
    }
    /// Current published context epoch.
    pub fn epoch(&self) -> Uuid {
        self.epoch
    }
    /// Prepared matching vocabulary.
    pub fn query(&self) -> &NameSearch {
        &self.query
    }
    /// Empty input is browsing, not exact matching of an empty label.
    pub fn browsing(&self) -> bool {
        matches!(&self.query,NameSearch::Name(q) if q.normalized().is_empty())
    }
    /// Command DM substitution is only active for a nonempty query.
    pub fn substitutes_dm(&self) -> bool {
        self.request.mode == PeopleMode::Command && !self.browsing()
    }
    /// Empty property pickers retain their independent self pin.
    pub fn self_pin(&self) -> bool {
        self.request.mode == PeopleMode::Property
            && self.browsing()
            && self
                .after
                .as_ref()
                .is_none_or(|a| a.priority >= SELF_PRIORITY)
    }
    /// Stages still reachable after the continuation, in descending priority.
    pub fn stages(&self) -> Vec<NameStage> {
        let stages = match &self.query {
            NameSearch::Identity(_) => vec![NameStage::Identity],
            NameSearch::EmailPrefix(_) => vec![NameStage::EmailPrefix],
            NameSearch::Name(q) if q.normalized().is_empty() => vec![NameStage::Browse],
            NameSearch::Name(q) if q.words().next().is_none() => {
                vec![
                    NameStage::ExactName,
                    NameStage::Contains,
                    NameStage::Address,
                ]
            }
            NameSearch::Name(_) => vec![
                NameStage::ExactName,
                NameStage::WordPrefix,
                NameStage::Contains,
                NameStage::Address,
            ],
        };
        // A stage is still reachable while its last tier, its weakest people in
        // no group, does not precede the continuation.
        stages
            .into_iter()
            .filter(|stage| {
                self.after.as_ref().is_none_or(|a| {
                    !tier_order(
                        self.listed(),
                        priority(*stage, Closeness::Other),
                        self.unlisted_group(),
                        a.priority,
                        a.group,
                    )
                    .is_lt()
                })
            })
            .collect()
    }
    /// Whether a list order ranks this search.
    fn listed(&self) -> bool {
        !self.request.list_priority.is_empty()
    }
    /// A list order supersedes the messaged and teammate splits: with one,
    /// people the viewer messages and teammates rank by their list group like
    /// everyone else.
    fn tier(&self, stage: NameStage, closeness: Closeness) -> u8 {
        if self.listed() {
            priority(stage, Closeness::Other)
        } else {
            priority(stage, closeness)
        }
    }
    /// Record keys of the requested teammates. An ordered scan stops early on
    /// the assumption that every teammate was already pushed, so a storage
    /// that stops early pushes these records before its ordered scans.
    pub fn teammate_keys(&self) -> Vec<EntityKey<'static>> {
        self.request
            .teammates
            .iter()
            .map(|id| crate::people::contact_key(&self.request.scope.identity, id.as_ref()))
            .collect()
    }
    /// Requested list groups, in priority order.
    pub fn list_groups(&self) -> &[Vec<String>] {
        &self.request.list_priority
    }
    /// The group of people in none of the requested groups; also the only
    /// group when no priority is requested.
    pub fn unlisted_group(&self) -> u8 {
        // At most MAX_LIST_GROUPS, checked by the constructor.
        u8::try_from(self.request.list_priority.len()).unwrap_or(u8::MAX)
    }
    /// Start of an ordered rank scan over one stage and list group. Within such
    /// a scan, messaged rows (positive time) have earlier keys than unmessaged
    /// ones and never follow them in window order, so the rows after the
    /// continuation are a suffix of the scan. Rows whose own group is better
    /// than the scan's were read by that group's earlier scan, and teammates
    /// by the teammate read before every scan.
    pub fn scan_start(&self, stage: NameStage, group: u8) -> ScanStart {
        let Some(after) = &self.after else {
            return ScanStart::First;
        };
        let messaged = tier_order(
            self.listed(),
            self.tier(stage, Closeness::Messaged),
            group,
            after.priority,
            after.group,
        );
        let unmessaged = tier_order(
            self.listed(),
            self.tier(stage, Closeness::Other),
            group,
            after.priority,
            after.group,
        );
        if messaged.is_gt() {
            return ScanStart::First;
        }
        if messaged.is_eq() || unmessaged.is_eq() {
            return MacroUserIdStr::parse_from_str(&after.user)
                .map(|user| {
                    ScanStart::After(
                        RecentKey::new(Some(after.timestamp), &user)
                            .as_bytes()
                            .to_vec(),
                    )
                })
                .unwrap_or(ScanStart::First);
        }
        if unmessaged.is_lt() {
            return ScanStart::Skip;
        }
        // Messaged rows were emitted and unmessaged ones were not (the
        // continuation may sit among teammates, between the two); reading the
        // messaged prefix again is wasted but harmless.
        ScanStart::First
    }
    fn evaluate<'b>(&self, key: &EntityKey<'_>, record: &'b Record) -> Option<Evaluated<'b>> {
        let raw = text(record, "userId")?;
        if raw.len() > 1024 {
            return None;
        }
        let user = MacroUserIdStr::parse_from_str(raw).ok()?;
        if self.excluded.contains(user.as_ref()) {
            return None;
        }
        let id = Uuid::new_v5(&self.namespace, user.as_ref().as_bytes());
        let mut buf = Uuid::encode_buffer();
        if key.as_ref().strip_prefix("GraphqlContact:")
            != Some(id.hyphenated().encode_lower(&mut buf))
        {
            return None;
        }
        let email = text(record, "email")?;
        if !email.eq_ignore_ascii_case(user.email_str()) {
            return None;
        }
        if self.request.mode == PeopleMode::Recipient
            && !matches!(&self.query,NameSearch::Identity(id) if id.as_ref()==user.as_ref())
            && is_automated_recipient_local_part(user.email_part().local_part())
        {
            return None;
        }
        let name = match record.fields.get("name") {
            Some(CacheValue::String(v)) => v.as_str(),
            Some(CacheValue::Null) => email.split('@').next().unwrap_or(email),
            _ => return None,
        };
        let facts = match record.fields.get(CONTEXT_FIELD) {
            None => PersonFacts::default(),
            Some(CacheValue::Opaque(v)) => {
                let stored: StoredFacts = serde_json::from_str(v).ok()?;
                if stored.epoch == self.epoch {
                    stored.facts
                } else {
                    PersonFacts::default()
                }
            }
            _ => return None,
        };
        if facts.secondary_inbox {
            return None;
        }
        let group = self.group(record);
        let stage = self.query.classify(&normalize_text(name), &user)?;
        let timestamp = if self.substitutes_dm() {
            facts
                .direct_message
                .as_ref()
                .map(|dm| dm.timestamp_ms)
                .or(facts.last_interaction_ms)
        } else {
            facts.last_interaction_ms
        }
        .unwrap_or(0);
        let self_pin = self.request.mode == PeopleMode::Property
            && self.browsing()
            && user.as_ref() == self.request.scope.identity;
        let closeness = if timestamp > 0 {
            Closeness::Messaged
        } else if self.teammates.contains(user.as_ref()) {
            Closeness::Teammate
        } else {
            Closeness::Other
        };
        let priority = if self_pin {
            SELF_PRIORITY
        } else {
            self.tier(stage, closeness)
        };
        let unlisted = self.unlisted_group();
        let group = match group {
            Some(group) => group,
            None if self.request.only_listed && !self_pin => return None,
            None => unlisted,
        };
        Some(Evaluated {
            user,
            name,
            email,
            facts,
            priority,
            group,
            timestamp,
        })
    }
    /// The first requested group holding any of the contact's lists.
    fn group(&self, record: &Record) -> Option<u8> {
        if self.request.list_priority.is_empty() {
            return None;
        }
        let lists = contact_lists(record);
        let index = self
            .request
            .list_priority
            .iter()
            .position(|group| group.iter().any(|key| lists.contains(key.as_str())))?;
        u8::try_from(index).ok()
    }
    fn after(&self, p: &Evaluated<'_>) -> bool {
        self.after.as_ref().is_none_or(|a| {
            tier_order(self.listed(), p.priority, p.group, a.priority, a.group)
                .then_with(|| a.timestamp.cmp(&p.timestamp))
                .then_with(|| p.user.as_ref().cmp(a.user.as_str()))
                .is_gt()
        })
    }
    /// Revalidate membership/flags and matching before entering bounded top-K.
    /// The optional stage guards broad SQL supersets, including overflow names.
    pub fn push(&mut self, key: &EntityKey<'_>, record: &Record, stage: Option<NameStage>) {
        let Some(p) = self.evaluate(key, record) else {
            return;
        };
        if !self.after(&p)
            || stage.is_some_and(|stage| !in_stage(stage, p.priority))
            || self.users.contains(p.user.as_ref())
        {
            return;
        }
        let dm = if self.substitutes_dm() {
            p.facts.direct_message.as_ref()
        } else {
            None
        };
        // Less when the existing winner ranks after the new person.
        let listed = self.listed();
        let compares = |old: &Winner| {
            tier_order(listed, p.priority, p.group, old.hit.match_rank, old.group)
                .then_with(|| old.hit.timestamp_ms.cmp(&p.timestamp))
                .then_with(|| p.user.as_ref().cmp(old.hit.user_id.as_ref()))
        };
        if let Some(dm) = dm
            && self.conversations.contains(&dm.id)
        {
            let Some(index) = self.best.iter().position(|old| {
                old.hit
                    .direct_message
                    .as_ref()
                    .is_some_and(|old| old.id == dm.id)
            }) else {
                return;
            };
            if !compares(&self.best[index]).is_lt() {
                return;
            }
            let old = self.best.remove(index);
            self.users.remove(old.hit.user_id.as_ref());
            self.conversations.remove(&dm.id);
        }
        if self.full() && self.best.last().is_some_and(|old| !compares(old).is_lt()) {
            return;
        }
        let hit = PersonHit {
            record_key: key.clone().into_owned(),
            user_id: p.user.into_owned(),
            name: p.name.into(),
            email: p.email.into(),
            last_interaction_ms: p.facts.last_interaction_ms,
            direct_message: p.facts.direct_message,
            match_rank: p.priority,
            score: 0.0,
            timestamp_ms: p.timestamp,
        };
        let winner = Winner {
            hit,
            group: p.group,
        };
        let index = self
            .best
            .binary_search_by(|old| compare(listed, old, &winner))
            .unwrap_or_else(|i| i);
        self.users.insert(winner.hit.user_id.to_string());
        if self.substitutes_dm()
            && let Some(dm) = &winner.hit.direct_message
        {
            self.conversations.insert(dm.id);
        }
        self.best.insert(index, winner);
        if self.best.len() > self.request.limit + 1
            && let Some(old) = self.best.pop()
        {
            self.users.remove(old.hit.user_id.as_ref());
            if self.substitutes_dm()
                && let Some(dm) = old.hit.direct_message
            {
                self.conversations.remove(&dm.id);
            }
        }
    }
    /// One extra winner proves a continuation; no result-history set is kept.
    pub fn full(&self) -> bool {
        self.best.len() > self.request.limit
    }
    /// A lower tier cannot improve an already-full higher-tier window.
    pub fn skip_stage(&self, stage: NameStage) -> bool {
        self.skip_group(stage, 0)
    }
    /// A worse group of this stage cannot improve an already-full window.
    pub fn skip_group(&self, stage: NameStage, group: u8) -> bool {
        self.full()
            && self.best.last().is_some_and(|worst| {
                tier_order(
                    self.listed(),
                    worst.hit.match_rank,
                    worst.group,
                    self.tier(stage, Closeness::Messaged),
                    group,
                )
                .is_lt()
            })
    }
    /// All future rows in this ordered scan of one stage and list group have
    /// keys at least `key`, so they are messaged only while the key's own time
    /// is positive. Rows whose own group is better were read by that group's
    /// earlier scan, so the scan's group bounds the rest, and teammates were
    /// read before the scan (`teammate_keys`), so the rest are not teammates.
    /// Only use for a validated projection within the same storage transaction.
    pub fn can_stop_at(&self, stage: NameStage, group: u8, key: &[u8]) -> bool {
        let closeness = if RecentKey::timestamp(key).is_none_or(|time| time > 0) {
            Closeness::Messaged
        } else {
            Closeness::Other
        };
        let best = self.tier(stage, closeness);
        self.full()
            && self.best.last().is_some_and(|worst| {
                tier_order(
                    self.listed(),
                    worst.hit.match_rank,
                    worst.group,
                    best,
                    group,
                )
                .then_with(|| {
                    RecentKey::new(Some(worst.hit.timestamp_ms), &worst.hit.user_id)
                        .as_bytes()
                        .cmp(key)
                })
                .is_le()
            })
    }
    /// At most K+1 conversation identities require prior-alias evidence.
    pub fn prior_dm_targets(&self) -> Vec<Uuid> {
        if self.after.is_some() && self.substitutes_dm() {
            self.conversations.iter().copied().collect()
        } else {
            vec![]
        }
    }
    /// A same-query, eligible alias on or before the previous boundary proves
    /// that this conversation was already emitted. Unrelated aliases do not.
    pub fn note_prior_alias(&mut self, key: &EntityKey<'_>, record: &Record) {
        let Some(p) = self.evaluate(key, record) else {
            return;
        };
        if self.after(&p) {
            return;
        }
        if let Some(dm) = p.facts.direct_message
            && self.conversations.contains(&dm.id)
        {
            self.prior.insert(dm.id);
        }
    }
    /// Materialize only winners. Short/empty pages retain advancement over the
    /// inspected window when prior conversation aliases were removed.
    pub fn finish(mut self) -> Result<PeopleSearchResult, PeopleError> {
        let truncated = self.full();
        self.best.truncate(self.request.limit);
        let next_cursor = if truncated {
            self.best
                .last()
                .map(|last| {
                    serde_json::to_string(&Continuation {
                        fingerprint: self.fingerprint,
                        priority: last.hit.match_rank,
                        group: last.group,
                        timestamp: last.hit.timestamp_ms,
                        user: last.hit.user_id.to_string(),
                    })
                })
                .transpose()?
        } else {
            None
        };
        Ok(PeopleSearchResult::Page {
            policy_version: crate::people::PEOPLE_POLICY_VERSION,
            people: self
                .best
                .into_iter()
                .map(|winner| winner.hit)
                .filter(|p| {
                    !p.direct_message
                        .as_ref()
                        .is_some_and(|dm| self.prior.contains(&dm.id))
                })
                .collect(),
            truncated,
            next_cursor,
        })
    }
}

#[cfg(test)]
mod test;
