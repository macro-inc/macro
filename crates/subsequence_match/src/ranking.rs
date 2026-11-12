//! Corpus-independent name relevance shared with the browser menus.
//! Scores never depend on the number or quality of other matches.

use crate::normalize_text;

/// Rank an exact visible label before a prefix, then other matches.
pub fn name_match_rank(label: &str, query: &str) -> u8 {
    let query = normalize_text(query);
    let label = normalize_text(label);
    name_match_rank_normalized(&label, &query)
}

/// Allocation-free tier comparison for already normalized inputs.
pub fn name_match_rank_normalized(label: &str, query: &str) -> u8 {
    if query.is_empty() {
        0
    } else if label == query {
        2
    } else if label.starts_with(query) {
        1
    } else {
        0
    }
}

/// Greedy token ranges in UTF-16 coordinates, matching JavaScript string lengths.
/// Every token must match; tokens may appear in either order, as in cache search.
fn span(text: &str, query: &str) -> Option<(usize, usize)> {
    let mut first = usize::MAX;
    let mut last = 0;
    for token in query.split_whitespace() {
        if let Some(start) = text.find(token) {
            first = first.min(start);
            last = last.max(start + token.len());
            continue;
        }
        let mut position = 0;
        for character in token.chars() {
            let relative = text.get(position..)?.find(character)?;
            let start = position + relative;
            first = first.min(start);
            position = start + character.len_utf8();
            last = last.max(position);
        }
    }
    let start = text.get(..first)?.encode_utf16().count();
    Some((start, text.get(first..last)?.encode_utf16().count()))
}

/// A deterministic score in [0, 1], or no match. Prefer positions in the visible
/// label when all tokens match there; otherwise score the full alias/email text.
/// Empty queries match with quality 1. No corpus-wide maximum is needed.
pub fn match_quality(
    label: &str,
    text: &str,
    query: &str,
    gap_weight: f64,
    start_decay: f64,
) -> Option<f64> {
    match_quality_normalized(
        &normalize_text(label),
        &normalize_text(text),
        &normalize_text(query),
        gap_weight,
        start_decay,
    )
}

/// Allocation-free quality for normalized projection text and query input.
pub fn match_quality_normalized(
    label: &str,
    text: &str,
    query: &str,
    gap_weight: f64,
    start_decay: f64,
) -> Option<f64> {
    if query.is_empty() {
        return Some(1.0);
    }
    let text_span = span(text, query)?;
    let (start, length) = if label == text {
        text_span
    } else {
        span(label, query).unwrap_or(text_span)
    };
    let ratio = (query.encode_utf16().count() as f64 / length.max(1) as f64).min(1.0);
    Some(
        (1.0 - (1.0 - ratio) * gap_weight.clamp(0.0, 1.0))
            / (1.0 + start as f64 * start_decay.max(0.0)),
    )
}

/// Recipient tiers: exact address, address prefix, word prefix, then other.
/// Unicode alphabetic/number word boundaries match the browser scorer.
pub fn recipient_match_rank(text: &str, email: Option<&str>, query: &str) -> u8 {
    let query = normalize_text(query);
    let email = email.map(str::to_lowercase);
    recipient_match_rank_normalized(&text.to_lowercase(), email.as_deref(), &query)
}

/// Recipient tiers without normalizing already-canonical inputs again.
pub fn recipient_match_rank_normalized(text: &str, email: Option<&str>, query: &str) -> u8 {
    if query.is_empty() {
        return 0;
    }
    if email == Some(query) {
        return 3;
    }
    if query.contains('@') && email.is_some_and(|email| email.starts_with(query)) {
        return 2;
    }
    let words: Vec<_> = text
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .collect();
    if query
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .all(|part| words.iter().any(|word| word.starts_with(part)))
    {
        1
    } else {
        0
    }
}

/// Whether an already-lowercased recipient local part denotes an automated
/// mailbox. The caller parses the address; explicit typed addresses remain valid.
pub fn is_automated_recipient_local_part(local: &str) -> bool {
    const PREFIXES: [&str; 4] = ["notifications", "mailer-daemon", "postmaster", "bounce"];
    const MARKERS: [&str; 20] = [
        "noreply",
        "no.reply",
        "no_reply",
        "no-reply",
        "donotreply",
        "donot.reply",
        "donot_reply",
        "donot-reply",
        "do.notreply",
        "do.not.reply",
        "do.not_reply",
        "do.not-reply",
        "do_notreply",
        "do_not.reply",
        "do_not_reply",
        "do_not-reply",
        "do-notreply",
        "do-not.reply",
        "do-not_reply",
        "do-not-reply",
    ];
    // Every marker contains "reply". Reject ordinary addresses before constructing
    // all 20 substring searchers, without skipping the independent prefix rules.
    PREFIXES.iter().any(|prefix| {
        local.strip_prefix(prefix).is_some_and(|suffix| {
            suffix.is_empty()
                || suffix
                    .as_bytes()
                    .first()
                    .is_some_and(|first| matches!(first, b'+' | b'.' | b'_' | b'-'))
        })
    }) || (local.contains("reply") && MARKERS.iter().any(|marker| local.contains(marker)))
}

/// Fixed blend weights for one surface, rather than a request's result corpus.
#[derive(Clone, Copy, Debug)]
pub struct Weights {
    /// Name-match contribution.
    pub fuzzy: f64,
    /// Interaction recency contribution.
    pub time: f64,
    /// Short-label contribution.
    pub brevity: f64,
    /// Age cutoff in milliseconds.
    pub max_age_ms: f64,
    /// Exponential decay within the cutoff.
    pub decay: f64,
    /// Low-quality threshold below which the result gets a 0.1 multiplier.
    pub minimum_quality: f64,
}

/// Score an eligible row independently. `text_length` uses UTF-16, as JS does.
pub fn blend(
    quality: f64,
    text_length: usize,
    timestamp_ms: Option<i64>,
    now_ms: i64,
    weights: Weights,
    multiplier: f64,
) -> f64 {
    let age = timestamp_ms.map(|timestamp| now_ms.saturating_sub(timestamp).max(0) as f64);
    let time = match age {
        Some(age) if weights.max_age_ms > 0.0 && age < weights.max_age_ms => {
            (-weights.decay * age / weights.max_age_ms).exp()
        }
        _ => 0.0,
    };
    let brevity = if text_length == 0 {
        0.0
    } else {
        (-2.0 * text_length.min(100) as f64 / 100.0).exp()
    };
    let total = weights.fuzzy + weights.time + weights.brevity;
    if total <= 0.0 {
        return 0.0;
    }
    let penalty = if quality < weights.minimum_quality {
        0.1
    } else {
        1.0
    };
    (weights.fuzzy * quality + weights.time * time + weights.brevity * brevity) / total
        * penalty
        * multiplier
}

#[cfg(test)]
mod test;
