//! Preserve server membership until the Mail index can confirm or reject it.
use super::*;
use std::collections::HashMap;

pub(super) async fn reconcile_window<S: PredicateIndexStorage>(
    engine: &mut Engine<S>,
    query: &ValidatedIndexQuery,
    window: Window,
    baseline: &[PredicateBaselineEntry],
) -> Result<(Window, Vec<String>), PageError<S::Error>> {
    if baseline.is_empty() {
        return Ok((window, Vec::new()));
    }
    let mut evidence: HashMap<_, _> = baseline
        .iter()
        .map(|entry| (entry.record_key.clone(), entry.sort_value))
        .collect();
    evidence.extend(
        window
            .keys
            .iter()
            .cloned()
            .zip(window.values.iter().copied()),
    );
    let combined = evidence
        .iter()
        .map(|(key, value)| PredicateBaselineEntry {
            record_key: key.clone(),
            sort_value: *value,
        })
        .collect::<Vec<_>>();
    // The indexed window already contains every local candidate to publish.
    // Do not admit the look-ahead row that only established `next_cursor`.
    let membership_query = query.with_limit(1).map_err(error)?;
    let result = engine
        .reconcile_predicate_index(&membership_query, &combined)
        .await?
        .value;
    let retained: HashSet<_> = result.retained_keys.iter().cloned().collect();
    let confirmed = result
        .keys
        .iter()
        .filter(|key| !retained.contains(*key))
        .cloned()
        .collect::<Vec<_>>();
    let values = sort_values(engine, query, &confirmed).await?;
    evidence.extend(confirmed.into_iter().zip(values));
    let values = result
        .keys
        .iter()
        .map(|key| {
            evidence
                .get(key)
                .copied()
                .ok_or_else(|| error("missing Mail baseline sort"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok((
        Window {
            keys: result.keys,
            values,
            more: window.more,
            optimistic: window.optimistic || result.optimistic,
        },
        result
            .retained_keys
            .into_iter()
            .map(|key| key.as_str().to_owned())
            .collect(),
    ))
}
