//! Bounded search facts appended to the existing authorized people projection.
use super::RecentKey;
use crate::{
    people::{CONTEXT_FIELD, StoredFacts},
    value::{CacheValue, Record},
};
use macro_user_id::user_id::MacroUserIdStr;
use predicate_index::{ExactFact, ExactValue, Token, ValidationError};
use std::collections::BTreeSet;
use subsequence_match::{names::words, normalize_text};

/// Maximum distinct indexed words per name. Overflow remains explicit so readers
/// can examine the normalized label rather than silently omit later words.
pub const MAX_NAME_WORDS: usize = 64;
/// Full normalized label for exact-name matching.
pub const NAME: &str = "people_name";
/// One fact per distinct normalized name word.
pub const WORD: &str = "people_word";
/// Extra name words exist outside the bounded posting list.
pub const WORD_OVERFLOW: &str = "people_word_overflow";
/// Default recency for contacts lacking facts in the currently published epoch.
pub const DEFAULT_RANK: &str = "people_rank_default";
/// Publication epoch represented by the sparse per-record overrides.
pub const CONTEXT_EPOCH: &str = "people_context_epoch";
/// Epoch-prefixed non-command activity ordering.
pub const USER_RANK: &str = "people_rank_user";
/// Epoch-prefixed viewed-first DM ordering for command substitution.
pub const COMMAND_RANK: &str = "people_rank_command";
/// Epoch-prefixed conversation identity; permits bounded alias lookups.
pub const DM: &str = "people_dm";
/// Epoch of a connected secondary-inbox exclusion.
pub const SECONDARY: &str = "people_secondary";
/// Malformed flags must never silently disable an exclusion.
pub const INVALID_CONTEXT: &str = "people_context_invalid";

fn fact(attribute: &str, bytes: impl Into<Vec<u8>>) -> Result<ExactFact, ValidationError> {
    Ok(ExactFact {
        attribute: Token::new(attribute)?,
        value: ExactValue::new(bytes)?,
    })
}

/// Call only after the parent projection validates membership, viewer key and
/// name/email fields. These facts never create membership by themselves.
pub(crate) fn derive(
    user: &MacroUserIdStr<'_>,
    name: &str,
    record: &Record,
) -> Result<Vec<ExactFact>, ValidationError> {
    let normalized = normalize_text(name);
    let mut indexed = BTreeSet::new();
    for word in words(&normalized) {
        indexed.insert(word);
        if indexed.len() > MAX_NAME_WORDS {
            break;
        }
    }
    let overflow = indexed.len() > MAX_NAME_WORDS;
    let mut facts = Vec::with_capacity(indexed.len() + 8);
    facts.push(fact(NAME, normalized.as_bytes())?);
    facts.push(fact(DEFAULT_RANK, RecentKey::new(None, user).as_bytes())?);
    for word in indexed.into_iter().take(MAX_NAME_WORDS) {
        facts.push(fact(WORD, word.as_bytes())?);
    }
    if overflow {
        facts.push(fact(WORD_OVERFLOW, b"1".as_slice())?);
    }
    let context = match record.fields.get(CONTEXT_FIELD) {
        None => return Ok(facts),
        Some(CacheValue::Opaque(value)) => serde_json::from_str::<StoredFacts>(value).ok(),
        _ => None,
    };
    let Some(context) = context else {
        facts.push(fact(INVALID_CONTEXT, b"1".as_slice())?);
        return Ok(facts);
    };
    facts.push(fact(CONTEXT_EPOCH, context.epoch.as_bytes().as_slice())?);
    facts.push(fact(
        USER_RANK,
        RecentKey::new(context.facts.last_interaction_ms, user).in_epoch(context.epoch),
    )?);
    let command_time = context
        .facts
        .direct_message
        .as_ref()
        .map(|dm| dm.timestamp_ms)
        .or(context.facts.last_interaction_ms);
    facts.push(fact(
        COMMAND_RANK,
        RecentKey::new(command_time, user).in_epoch(context.epoch),
    )?);
    if let Some(dm) = context.facts.direct_message {
        facts.push(fact(
            DM,
            [
                context.epoch.as_bytes().as_slice(),
                dm.id.as_bytes().as_slice(),
            ]
            .concat(),
        )?);
    }
    if context.facts.secondary_inbox {
        facts.push(fact(SECONDARY, context.epoch.as_bytes().as_slice())?);
    }
    Ok(facts)
}
