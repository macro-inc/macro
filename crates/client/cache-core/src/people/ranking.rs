use super::cursor::{Cursor, Position, fingerprint};
use super::*;
use crate::value::{CacheValue, Record};
use macro_user_id::{cowlike::CowLike, email::ReadEmailParts};
use std::{
    cmp::Ordering,
    collections::{BinaryHeap, HashSet},
};
use subsequence_match::{
    normalize_text,
    ranking::{
        Weights, blend, is_automated_recipient_local_part, match_quality_normalized,
        name_match_rank_normalized, recipient_match_rank_normalized,
    },
    subsequence_score,
};

struct Ranked(PersonHit);
impl PartialEq for Ranked {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other).is_eq()
    }
}
impl Eq for Ranked {}
impl PartialOrd for Ranked {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl Ord for Ranked {
    fn cmp(&self, other: &Self) -> Ordering {
        compare(&self.0, &other.0)
    }
}
fn compare(left: &PersonHit, right: &PersonHit) -> Ordering {
    right
        .match_rank
        .cmp(&left.match_rank)
        .then_with(|| right.score.total_cmp(&left.score))
        .then_with(|| right.timestamp_ms.cmp(&left.timestamp_ms))
        .then_with(|| left.user_id.as_ref().cmp(right.user_id.as_ref()))
}
fn string<'a>(record: &'a Record, key: &str) -> Option<&'a str> {
    match record.fields.get(key) {
        Some(CacheValue::String(value)) => Some(value),
        _ => None,
    }
}

pub(crate) struct PeopleRanker<'a> {
    request: &'a PeopleSearch,
    epoch: Uuid,
    query: String,
    excluded: HashSet<&'a str>,
    best: BinaryHeap<Ranked>,
    conversations: HashSet<Uuid>,
    prior_conversations: HashSet<Uuid>,
    prior_scan: bool,
    after: Option<Position>,
    now_ms: i64,
    fingerprint: String,
}
impl<'a> PeopleRanker<'a> {
    pub(crate) fn new(request: &'a PeopleSearch, epoch: Uuid) -> Result<Self, PeopleError> {
        let fingerprint = fingerprint(request, epoch)?;
        let cursor = request
            .cursor
            .as_deref()
            .map(|value| Cursor::decode(value, &fingerprint))
            .transpose()?;
        let now_ms = cursor
            .as_ref()
            .map_or(request.now_ms, |cursor| cursor.now_ms);
        Ok(Self {
            request,
            epoch,
            query: normalize_text(&request.query),
            excluded: request.excluded.iter().map(|id| id.as_ref()).collect(),
            best: BinaryHeap::with_capacity(request.limit + 1),
            conversations: HashSet::with_capacity(request.limit + 1),
            prior_conversations: HashSet::new(),
            prior_scan: false,
            after: cursor.map(|cursor| cursor.after),
            now_ms,
            fingerprint,
        })
    }
    /// A second bounded-memory scan removes conversations already emitted by an
    /// earlier window, even when another contact alias gives that DM a lower score.
    pub(crate) fn scan_prior_conversations(&mut self) -> bool {
        self.prior_scan = self.after.is_some() && !self.conversations.is_empty();
        self.prior_conversations.clear();
        self.prior_scan
    }
    pub(crate) fn push(&mut self, key: &EntityKey<'_>, record: &Record) {
        let Some(user) = string(record, "userId") else {
            return;
        };
        if user.len() > 1024 {
            return;
        }
        let Ok(user_id) = MacroUserIdStr::parse_from_str(user) else {
            return;
        };
        if self.excluded.contains(user_id.as_ref()) {
            return;
        }
        let user = user_id.as_ref();
        let Some(email) = string(record, "email") else {
            return;
        };
        if !email.eq_ignore_ascii_case(user_id.email_str()) {
            return;
        }
        let normalized_email = user_id.email_str();
        if self.request.mode == PeopleMode::Recipient
            && self.query != normalized_email
            && is_automated_recipient_local_part(user_id.email_part().local_part())
        {
            return;
        }
        let name = match record.fields.get("name") {
            Some(CacheValue::String(value)) => value.as_str(),
            None | Some(CacheValue::Null) => email.split('@').next().unwrap_or(email),
            _ => return,
        };
        let facts = match record.fields.get(CONTEXT_FIELD) {
            None => PersonFacts::default(),
            Some(CacheValue::Opaque(value)) => {
                // Malformed local flags must never silently disable an exclusion.
                let Ok(stored) = serde_json::from_str::<StoredFacts>(value) else {
                    return;
                };
                if stored.epoch == self.epoch {
                    stored.facts
                } else {
                    PersonFacts::default()
                }
            }
            _ => return,
        };
        if facts.secondary_inbox {
            return;
        }
        let label = normalize_text(name);
        let base_text = format!("{label} | {normalized_email}");
        if !self
            .query
            .split_whitespace()
            .all(|token| subsequence_score(&base_text, token).is_some())
        {
            return;
        }
        let dm = if self.request.mode == PeopleMode::Command && !self.query.is_empty() {
            facts.direct_message.as_ref()
        } else {
            None
        };
        let command_label = dm.map(|dm| normalize_text(&dm.name));
        let rank_label = command_label.as_deref().unwrap_or(&label);
        let command_text = command_label
            .as_ref()
            .map(|label| format!("{label} | {base_text}"));
        let text = command_text.as_deref().unwrap_or(&base_text);
        let text_length = name.encode_utf16().count()
            + 3
            + email.encode_utf16().count()
            + dm.map_or(0, |dm| dm.name.encode_utf16().count() + 3);
        let timestamp = dm.map(|dm| dm.timestamp_ms).or(facts.last_interaction_ms);
        let mut multiplier = if dm.is_some() { 3.0 * 1.8 } else { 1.0 };
        let (fuzzy, time, brevity, gap, start) = match self.request.mode {
            PeopleMode::Command => (0.7, 0.7, 0.0, 0.4, 0.2),
            PeopleMode::Recipient => (0.5, 1.5, 1.0, 0.0, 0.0),
            PeopleMode::Mention if self.query.is_empty() => (0.0, 0.9, 0.0, 0.0, 0.0),
            PeopleMode::Mention => (0.7, 0.2, 0.1, 0.4, 0.2),
            PeopleMode::Property => (0.5, 0.4, 0.1, 0.0, 0.0),
        };
        let Some(quality) = match_quality_normalized(rank_label, text, &self.query, gap, start)
        else {
            return;
        };
        if self.request.mode != PeopleMode::Command {
            let same_domain = self.request.sender_domain.as_deref().is_some_and(|domain| {
                email
                    .rsplit_once('@')
                    .is_some_and(|(_, email_domain)| email_domain.eq_ignore_ascii_case(domain))
            });
            multiplier = match self.request.mode {
                PeopleMode::Mention => {
                    if self.query.is_empty() {
                        1.2
                    } else {
                        1.6
                    }
                }
                PeopleMode::Property if user == self.request.scope.identity => 11.0,
                PeopleMode::Recipient if !self.query.is_empty() => {
                    1.25 + if same_domain { 0.0625 } else { 0.0 }
                }
                _ => {
                    if same_domain {
                        1.5
                    } else {
                        1.0
                    }
                }
            };
        }
        let match_rank = if self.query.is_empty() {
            u8::from(
                self.request.mode == PeopleMode::Property && user == self.request.scope.identity,
            )
        } else {
            match self.request.mode {
                PeopleMode::Command => name_match_rank_normalized(rank_label, &self.query),
                PeopleMode::Recipient => {
                    recipient_match_rank_normalized(&base_text, Some(normalized_email), &self.query)
                }
                PeopleMode::Mention => name_match_rank_normalized(rank_label, &self.query),
                PeopleMode::Property => 0,
            }
        };
        let score = if matches!(
            self.request.mode,
            PeopleMode::Command | PeopleMode::Property
        ) && self.query.is_empty()
        {
            0.0
        } else {
            blend(
                quality,
                text_length,
                timestamp,
                self.now_ms,
                Weights {
                    fuzzy,
                    time,
                    brevity,
                    max_age_ms: 30.0 * 24.0 * 60.0 * 60.0 * 1000.0,
                    decay: 0.5,
                    minimum_quality: 0.1,
                },
                multiplier,
            )
        };
        let timestamp_ms = timestamp.unwrap_or(0);
        if self
            .after
            .as_ref()
            .is_some_and(|after| !after.compare(match_rank, score, timestamp_ms, user).is_gt())
        {
            if self.prior_scan
                && let Some(dm) = dm
                && self.conversations.contains(&dm.id)
            {
                self.prior_conversations.insert(dm.id);
            }
            return;
        }
        if self.prior_scan {
            return;
        }
        if let Some(dm) = dm
            && self.conversations.contains(&dm.id)
        {
            let improves = self
                .best
                .iter()
                .find(|hit| {
                    hit.0
                        .direct_message
                        .as_ref()
                        .is_some_and(|old| old.id == dm.id)
                })
                .is_some_and(|old| {
                    old.0
                        .match_rank
                        .cmp(&match_rank)
                        .then_with(|| old.0.score.total_cmp(&score))
                        .then_with(|| old.0.timestamp_ms.cmp(&timestamp_ms))
                        .then_with(|| user.cmp(old.0.user_id.as_ref()))
                        .is_lt()
                });
            if !improves {
                return;
            }
            self.best.retain(|hit| {
                hit.0
                    .direct_message
                    .as_ref()
                    .is_none_or(|old| old.id != dm.id)
            });
            self.conversations.remove(&dm.id);
        }
        if self.best.len() == self.request.limit + 1
            && self.best.peek().is_some_and(|worst| {
                let order = worst
                    .0
                    .match_rank
                    .cmp(&match_rank)
                    .then_with(|| worst.0.score.total_cmp(&score))
                    .then_with(|| worst.0.timestamp_ms.cmp(&timestamp_ms))
                    .then_with(|| user.cmp(worst.0.user_id.as_ref()));
                !order.is_lt()
            })
        {
            return;
        }
        let hit = Ranked(PersonHit {
            record_key: key.clone().into_owned(),
            user_id: user_id.into_owned(),
            name: name.into(),
            email: email.into(),
            last_interaction_ms: facts.last_interaction_ms,
            direct_message: facts.direct_message.clone(),
            match_rank,
            score,
            timestamp_ms,
        });
        if self.best.len() == self.request.limit + 1 {
            let removed = self.best.pop();
            if self.request.mode == PeopleMode::Command
                && !self.query.is_empty()
                && let Some(dm) = removed.and_then(|removed| removed.0.direct_message)
            {
                self.conversations.remove(&dm.id);
            }
        }
        if let Some(dm) = dm {
            self.conversations.insert(dm.id);
        }
        self.best.push(hit);
    }
    pub(crate) fn finish(self) -> Result<PeopleSearchResult, PeopleError> {
        let truncated = self.best.len() > self.request.limit;
        let mut hits = self.best.into_sorted_vec();
        hits.truncate(self.request.limit);
        // Advance over the whole inspected rank window, including duplicates of
        // prior conversations, without retaining previous pages or their IDs.
        let next_cursor = if truncated {
            hits.last()
                .map(|hit| {
                    Cursor::encode(self.fingerprint, self.now_ms, Position::from_hit(&hit.0))
                })
                .transpose()?
        } else {
            None
        };
        Ok(PeopleSearchResult::Page {
            policy_version: PEOPLE_POLICY_VERSION,
            people: hits
                .into_iter()
                .filter(|hit| {
                    !hit.0
                        .direct_message
                        .as_ref()
                        .is_some_and(|dm| self.prior_conversations.contains(&dm.id))
                })
                .map(|hit| hit.0)
                .collect(),
            truncated,
            next_cursor,
        })
    }
}

#[cfg(test)]
mod test;
