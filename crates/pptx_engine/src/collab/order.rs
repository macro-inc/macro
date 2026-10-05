//! Fractional position keys for ordering slides and shapes in CRDT maps.
//!
//! Keys are base-62 fractions in (0, 1) compared as plain strings. A key never
//! ends in the smallest digit, so there is always room before and after it.
//! Concurrent writers can mint the same key; readers break ties by id. This
//! is the scheme the web app's collaborative DOCX editor uses.

use std::collections::{BTreeMap, HashSet};

const DIGITS: &[u8; 62] = b"0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE: usize = 62;

fn digit_value(c: u8) -> usize {
    DIGITS.iter().position(|&d| d == c).unwrap_or(0)
}

fn midpoint(low: &[u8], high: Option<&[u8]>) -> Vec<u8> {
    if let Some(high) = high {
        let mut shared = 0;
        while shared < high.len() && low.get(shared).copied().unwrap_or(DIGITS[0]) == high[shared] {
            shared += 1;
        }
        if shared > 0 {
            let mut out = high[..shared].to_vec();
            let low_rest = low.get(shared..).unwrap_or(&[]);
            out.extend(midpoint(low_rest, Some(&high[shared..])));
            return out;
        }
    }
    let low_digit = low.first().map_or(0, |&c| digit_value(c));
    let high_digit = high.map_or(BASE, |h| h.first().map_or(0, |&c| digit_value(c)));
    if high_digit - low_digit > 1 {
        return vec![DIGITS[(low_digit + high_digit) / 2]];
    }
    // Adjacent digits: the high key's first digit alone sorts between them when
    // the high key continues, otherwise extend the low key.
    if let Some(high) = high
        && high.len() > 1
    {
        return vec![high[0]];
    }
    let mut out = vec![DIGITS[low_digit]];
    out.extend(midpoint(low.get(1..).unwrap_or(&[]), None));
    out
}

fn valid(key: &str) -> bool {
    !key.is_empty() && !key.ends_with('0') && key.bytes().all(|c| DIGITS.contains(&c))
}

/// A key strictly between `low` and `high` (`None` = the open end).
///
/// Invalid or out-of-order bounds (possible only from a malformed document)
/// are treated as open ends, so the result is always a valid key.
pub fn key_between(low: Option<&str>, high: Option<&str>) -> String {
    let low = low.filter(|k| valid(k));
    let high = high
        .filter(|k| valid(k))
        .filter(|h| low.is_none_or(|l| l < *h));
    let key = midpoint(low.unwrap_or("").as_bytes(), high.map(str::as_bytes));
    String::from_utf8(key).expect("ascii digits")
}

/// `count` ascending keys between `low` and `high`, growing logarithmically.
pub fn keys_between(low: Option<&str>, high: Option<&str>, count: usize) -> Vec<String> {
    if count == 0 {
        return Vec::new();
    }
    let middle = key_between(low, high);
    if count == 1 {
        return vec![middle];
    }
    let before = (count - 1) / 2;
    let mut out = keys_between(low, Some(&middle), before);
    out.push(middle.clone());
    out.extend(keys_between(Some(&middle), high, count - 1 - before));
    out
}

/// Indices of a longest strictly increasing subsequence of `values`.
fn longest_increasing(values: &[String]) -> HashSet<usize> {
    let mut tails: Vec<usize> = Vec::new();
    let mut previous = vec![usize::MAX; values.len()];
    for (index, value) in values.iter().enumerate() {
        let at = tails.partition_point(|&t| values[t] < *value);
        if at > 0 {
            previous[index] = tails[at - 1];
        }
        if at == tails.len() {
            tails.push(index);
        } else {
            tails[at] = index;
        }
    }
    let mut keep = HashSet::new();
    let mut cursor = tails.last().copied().unwrap_or(usize::MAX);
    while cursor != usize::MAX {
        keep.insert(cursor);
        cursor = previous[cursor];
    }
    keep
}

/// Position keys for `order` that reuse as many `existing` keys as possible:
/// items already in relative order keep their keys; moved and new items get
/// fresh keys between their kept neighbours. Returns only keys that change.
pub fn reorder_keys(
    existing: &BTreeMap<String, String>,
    order: &[String],
) -> BTreeMap<String, String> {
    let mut current: Vec<Option<String>> =
        order.iter().map(|id| existing.get(id).cloned()).collect();
    let candidates: Vec<usize> = (0..order.len()).filter(|&i| current[i].is_some()).collect();
    // Ties between concurrently minted keys break by id, as readers do.
    let sortable: Vec<String> = candidates
        .iter()
        .map(|&i| format!("{}\u{0}{}", current[i].as_deref().unwrap_or(""), order[i]))
        .collect();
    let kept_candidates = longest_increasing(&sortable);
    let mut kept = HashSet::new();
    let mut previous_key: Option<&str> = None;
    for (n, &index) in candidates.iter().enumerate() {
        if !kept_candidates.contains(&n) {
            continue;
        }
        // Concurrent peers can mint the same key; re-key the later item so new
        // keys always have a strictly ordered pair of neighbours.
        let key = current[index].as_deref();
        if key == previous_key || key.is_some_and(|k| !valid(k)) {
            continue;
        }
        previous_key = key;
        kept.insert(index);
    }

    let mut changed = BTreeMap::new();
    let mut index = 0;
    while index < order.len() {
        if kept.contains(&index) {
            index += 1;
            continue;
        }
        let run_start = index;
        while index < order.len() && !kept.contains(&index) {
            index += 1;
        }
        let low = if run_start > 0 {
            current[run_start - 1].clone()
        } else {
            None
        };
        let high = current.get(index).cloned().flatten();
        let keys = keys_between(low.as_deref(), high.as_deref(), index - run_start);
        for (i, key) in (run_start..index).zip(keys) {
            current[i] = Some(key.clone());
            changed.insert(order[i].clone(), key);
        }
    }
    changed
}

/// Ids sorted by position key, ties broken by id.
pub fn sorted_by_key<'a>(items: impl Iterator<Item = (&'a str, &'a str)>) -> Vec<&'a str> {
    let mut items: Vec<(&str, &str)> = items.collect();
    items.sort_by(|a, b| a.1.cmp(b.1).then_with(|| a.0.cmp(b.0)));
    items.into_iter().map(|(id, _)| id).collect()
}
