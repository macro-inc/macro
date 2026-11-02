//! Bounded ranking over borrowed catalog/optimistic entries. Only the final
//! results are cloned; the heap retains at most limit + 1 references.

use super::{
    SearchCursor, SearchDocument, SearchPage, SearchRequest, compare_recent, normalize_search_text,
    score_normalized_query,
};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

struct Scored<'a> {
    document: &'a SearchDocument,
    score: f64,
}

impl Ord for Scored<'_> {
    fn cmp(&self, other: &Self) -> Ordering {
        // Exactly the original ascending sort comparator: better results are
        // smaller, so BinaryHeap keeps the worst retained result at its root.
        other
            .score
            .total_cmp(&self.score)
            .then_with(|| compare_recent(self.document, other.document))
    }
}
impl PartialOrd for Scored<'_> {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl PartialEq for Scored<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other).is_eq()
    }
}
impl Eq for Scored<'_> {}

pub(crate) fn rank_documents<'a>(
    request: &SearchRequest,
    documents: impl IntoIterator<Item = &'a SearchDocument>,
) -> SearchPage {
    let query = normalize_search_text(request.query.trim());
    let capacity = request.limit + 1;
    let mut best = BinaryHeap::with_capacity(capacity);
    for document in documents {
        let score = if query.is_empty() {
            Some(0.0)
        } else {
            score_normalized_query(document, &query, request.now_ms)
        };
        let Some(score) = score else {
            continue;
        };
        let candidate = Scored { document, score };
        if best.len() < capacity {
            best.push(candidate);
        } else if let Some(mut worst) = best.peek_mut()
            && candidate < *worst
        {
            *worst = candidate;
        }
    }
    let has_more = best.len() > request.limit;
    let documents: Vec<_> = best
        .into_sorted_vec()
        .into_iter()
        .take(request.limit)
        .map(|hit| hit.document.clone())
        .collect();
    let next_cursor = (query.is_empty() && has_more).then(|| {
        let last = documents.last().expect("validated nonzero search limit");
        SearchCursor {
            timestamp_ms: last.timestamp_ms,
            record_key: last.record_key.clone(),
        }
    });
    SearchPage {
        documents,
        next_cursor,
    }
}

#[cfg(test)]
mod test;
