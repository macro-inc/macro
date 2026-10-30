//! Incremental ranking of streamed storage rows and optimistic projections.
//! Only winners are cloned; the heap owns at most limit + 1 documents.

use super::{
    SearchCursor, SearchDocument, SearchPage, SearchQuery, SearchRequest, compare_recent,
    score_normalized_query,
};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

struct Scored {
    document: SearchDocument,
    score: f64,
}

impl Ord for Scored {
    fn cmp(&self, other: &Self) -> Ordering {
        compare(&self.document, self.score, &other.document, other.score)
    }
}
impl PartialOrd for Scored {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}
impl PartialEq for Scored {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other).is_eq()
    }
}
impl Eq for Scored {}

fn compare(
    left: &SearchDocument,
    left_score: f64,
    right: &SearchDocument,
    right_score: f64,
) -> Ordering {
    // Better results are smaller, so the heap keeps its worst result at the root.
    right_score
        .total_cmp(&left_score)
        .then_with(|| compare_recent(left, right))
}

pub(crate) struct SearchRanker<'a> {
    request: &'a SearchRequest,
    query: &'a SearchQuery,
    best: BinaryHeap<Scored>,
}

impl<'a> SearchRanker<'a> {
    pub(crate) fn new(request: &'a SearchRequest, query: &'a SearchQuery) -> Self {
        Self {
            request,
            query,
            best: BinaryHeap::with_capacity(request.limit + 1),
        }
    }

    pub(crate) fn push(&mut self, document: &SearchDocument) {
        let score = if self.query.0.is_empty() {
            Some(0.0)
        } else {
            score_normalized_query(document, &self.query.0, self.request.now_ms)
        };
        let Some(score) = score else { return };
        if self.best.len() < self.request.limit + 1 {
            self.best.push(Scored {
                document: document.clone(),
                score,
            });
        } else if let Some(mut worst) = self.best.peek_mut()
            && compare(document, score, &worst.document, worst.score).is_lt()
        {
            *worst = Scored {
                document: document.clone(),
                score,
            };
        }
    }

    pub(crate) fn finish(self) -> SearchPage {
        let has_more = self.best.len() > self.request.limit;
        let documents: Vec<_> = self
            .best
            .into_sorted_vec()
            .into_iter()
            .take(self.request.limit)
            .map(|hit| hit.document)
            .collect();
        let next_cursor = documents
            .last()
            .filter(|_| self.query.0.is_empty() && has_more)
            .map(|last| SearchCursor {
                timestamp_ms: last.timestamp_ms,
                record_key: last.record_key.clone(),
            });
        SearchPage {
            documents,
            next_cursor,
        }
    }
}

#[cfg(test)]
mod test;
