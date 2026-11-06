//! Bounded name-policy collector shared by indexed storage and the reference scan.
use super::{NameSearch, NameStage, RecentKey};
use crate::{
    people::{
        CONTEXT_FIELD, MAX_PEOPLE_BATCH, PeopleError, PeopleMode, PeopleSearch, PeopleSearchResult,
        PersonFacts, PersonHit, StoredFacts,
    },
    value::{CacheValue, EntityKey, Record},
};
use macro_user_id::{cowlike::CowLike, email::ReadEmailParts, user_id::MacroUserIdStr};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use subsequence_match::{normalize_text, ranking::is_automated_recipient_local_part};
use uuid::Uuid;

/// New reader contract; the host floor is switched in the coordinated cutover.
pub const NAME_POLICY_VERSION: u32 = 5;
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
    timestamp: i64,
    user: String,
}

struct Evaluated<'a> {
    user: MacroUserIdStr<'a>,
    name: &'a str,
    email: &'a str,
    facts: PersonFacts,
    priority: u8,
    timestamp: i64,
}
fn text<'a>(record: &'a Record, field: &str) -> Option<&'a str> {
    match record.fields.get(field) {
        Some(CacheValue::String(value)) => Some(value),
        _ => None,
    }
}
fn priority(stage: NameStage) -> u8 {
    match stage {
        NameStage::Browse => 0,
        NameStage::Contains => 1,
        NameStage::WordPrefix => 2,
        NameStage::ExactName => 3,
        NameStage::EmailPrefix => 4,
        NameStage::Identity => 5,
    }
}
const SELF_PRIORITY: u8 = 6;
fn compare(a: &PersonHit, b: &PersonHit) -> std::cmp::Ordering {
    b.match_rank
        .cmp(&a.match_rank)
        .then_with(|| b.timestamp_ms.cmp(&a.timestamp_ms))
        .then_with(|| a.user_id.as_ref().cmp(b.user_id.as_ref()))
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
    best: Vec<PersonHit>,
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
                NAME_POLICY_VERSION,
                crate::people::sql::projection::VERSION,
                &request.scope,
                epoch,
                version.contacts,
                version.context,
                request.mode,
                &request.query,
                &request.excluded,
                &request.sender_domain
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
                vec![NameStage::ExactName, NameStage::Contains]
            }
            NameSearch::Name(_) => vec![
                NameStage::ExactName,
                NameStage::WordPrefix,
                NameStage::Contains,
            ],
        };
        stages
            .into_iter()
            .filter(|stage| {
                self.after
                    .as_ref()
                    .is_none_or(|a| priority(*stage) <= a.priority)
            })
            .collect()
    }
    /// Exclusive stored rank-key bound for a same-stage continuation.
    pub fn after_key(&self, stage: NameStage) -> Option<Vec<u8>> {
        let after = self
            .after
            .as_ref()
            .filter(|a| a.priority == priority(stage))?;
        let user = MacroUserIdStr::parse_from_str(&after.user).ok()?;
        Some(
            RecentKey::new(Some(after.timestamp), &user)
                .as_bytes()
                .to_vec(),
        )
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
        let stage = self.query.classify(&normalize_text(name), &user)?;
        let priority = if self.request.mode == PeopleMode::Property
            && self.browsing()
            && user.as_ref() == self.request.scope.identity
        {
            SELF_PRIORITY
        } else {
            priority(stage)
        };
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
        Some(Evaluated {
            user,
            name,
            email,
            facts,
            priority,
            timestamp,
        })
    }
    fn after(&self, p: &Evaluated<'_>) -> bool {
        self.after.as_ref().is_none_or(|a| {
            p.priority < a.priority
                || p.priority == a.priority
                    && (p.timestamp < a.timestamp
                        || p.timestamp == a.timestamp && p.user.as_ref() > a.user.as_str())
        })
    }
    /// Revalidate membership/flags and matching before entering bounded top-K.
    /// The optional stage guards broad SQL supersets, including overflow names.
    pub fn push(&mut self, key: &EntityKey<'_>, record: &Record, stage: Option<NameStage>) {
        let Some(p) = self.evaluate(key, record) else {
            return;
        };
        if !self.after(&p)
            || stage.is_some_and(|stage| priority(stage) != p.priority)
            || self.users.contains(p.user.as_ref())
        {
            return;
        }
        let dm = if self.substitutes_dm() {
            p.facts.direct_message.as_ref()
        } else {
            None
        };
        let compares = |old: &PersonHit| {
            old.match_rank
                .cmp(&p.priority)
                .then_with(|| old.timestamp_ms.cmp(&p.timestamp))
                .then_with(|| p.user.as_ref().cmp(old.user_id.as_ref()))
        };
        if let Some(dm) = dm
            && self.conversations.contains(&dm.id)
        {
            let Some(index) = self.best.iter().position(|old| {
                old.direct_message
                    .as_ref()
                    .is_some_and(|old| old.id == dm.id)
            }) else {
                return;
            };
            if !compares(&self.best[index]).is_lt() {
                return;
            }
            let old = self.best.remove(index);
            self.users.remove(old.user_id.as_ref());
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
        let index = self
            .best
            .binary_search_by(|old| compare(old, &hit))
            .unwrap_or_else(|i| i);
        self.users.insert(hit.user_id.to_string());
        if self.substitutes_dm()
            && let Some(dm) = &hit.direct_message
        {
            self.conversations.insert(dm.id);
        }
        self.best.insert(index, hit);
        if self.best.len() > self.request.limit + 1
            && let Some(old) = self.best.pop()
        {
            self.users.remove(old.user_id.as_ref());
            if self.substitutes_dm()
                && let Some(dm) = old.direct_message
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
        self.full()
            && self
                .best
                .last()
                .is_some_and(|last| last.match_rank > priority(stage))
    }
    /// All future rows in this ordered stage have keys at least `key`.
    /// Only use for a validated projection within the same storage transaction.
    pub fn can_stop_at(&self, stage: NameStage, key: &[u8]) -> bool {
        self.full()
            && self.best.last().is_some_and(|worst| {
                worst.match_rank > priority(stage)
                    || worst.match_rank == priority(stage)
                        && RecentKey::new(Some(worst.timestamp_ms), &worst.user_id).as_bytes()
                            <= key
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
                        priority: last.match_rank,
                        timestamp: last.timestamp_ms,
                        user: last.user_id.to_string(),
                    })
                })
                .transpose()?
        } else {
            None
        };
        Ok(PeopleSearchResult::Page {
            policy_version: NAME_POLICY_VERSION,
            people: self
                .best
                .into_iter()
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
