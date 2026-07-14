//! Confusion matrix, precision/recall, and the human-readable report each
//! measurement prints. Pure logic — unit-tested in `eval_corpus.rs`.

use task_dedup::eval::PairCase;

/// A binary-classification tally of predicted-vs-expected duplicate verdicts.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Confusion {
    /// Expected duplicate, predicted duplicate.
    pub tp: u32,
    /// Expected non-duplicate, predicted duplicate (a false positive — the bug
    /// dedup is most criticized for).
    pub fp: u32,
    /// Expected non-duplicate, predicted non-duplicate.
    pub tn: u32,
    /// Expected duplicate, predicted non-duplicate (a missed duplicate).
    pub r#fn: u32,
}

impl Confusion {
    /// Records one predicted-vs-expected outcome.
    pub fn record(&mut self, expected: bool, predicted: bool) {
        match (expected, predicted) {
            (true, true) => self.tp += 1,
            (false, true) => self.fp += 1,
            (false, false) => self.tn += 1,
            (true, false) => self.r#fn += 1,
        }
    }

    /// Total outcomes recorded.
    pub fn total(&self) -> u32 {
        self.tp + self.fp + self.tn + self.r#fn
    }

    /// Fraction of predicted duplicates that were real. `None` when nothing was
    /// predicted duplicate.
    pub fn precision(&self) -> Option<f64> {
        let denom = self.tp + self.fp;
        (denom > 0).then(|| self.tp as f64 / denom as f64)
    }

    /// Fraction of real duplicates that were caught. `None` when there were no
    /// real duplicates.
    pub fn recall(&self) -> Option<f64> {
        let denom = self.tp + self.r#fn;
        (denom > 0).then(|| self.tp as f64 / denom as f64)
    }

    /// Harmonic mean of precision and recall.
    pub fn f1(&self) -> Option<f64> {
        match (self.precision(), self.recall()) {
            (Some(p), Some(r)) if p + r > 0.0 => Some(2.0 * p * r / (p + r)),
            _ => None,
        }
    }

    /// Fraction of all outcomes that were correct.
    pub fn accuracy(&self) -> Option<f64> {
        let total = self.total();
        (total > 0).then(|| (self.tp + self.tn) as f64 / total as f64)
    }
}

/// Formats an optional ratio as a percentage, or `n/a`.
pub fn fmt_ratio(value: Option<f64>) -> String {
    value.map_or_else(|| "  n/a".to_string(), |v| format!("{:.1}%", v * 100.0))
}

/// One operating point of a score-threshold sweep: the confusion matrix you get
/// when predicting "duplicate" for every pair whose score is at or above
/// `threshold`.
#[derive(Debug, Clone, Copy)]
pub struct SweepPoint {
    /// The score cutoff applied (`predicted = score >= threshold`).
    pub threshold: f64,
    /// The resulting tally over all scored pairs.
    pub confusion: Confusion,
}

/// Sweeps a similarity cutoff over `thresholds`, tallying `predicted = score >=
/// threshold` against each pair's ground-truth label. `points` are `(score,
/// expected_duplicate)`. This turns a single embed pass into a full
/// precision/recall curve, so the vector floor is chosen from data rather than
/// fixed blind.
pub fn threshold_sweep(points: &[(f64, bool)], thresholds: &[f64]) -> Vec<SweepPoint> {
    thresholds
        .iter()
        .map(|&threshold| {
            let mut confusion = Confusion::default();
            for &(score, expected) in points {
                confusion.record(expected, score >= threshold);
            }
            SweepPoint {
                threshold,
                confusion,
            }
        })
        .collect()
}

/// Average precision: the area under the precision/recall curve, computed by
/// ranking every pair by score descending and averaging the precision at each
/// true positive. A threshold-free summary of how separable duplicates are by
/// score alone; `None` when there are no positives. Ties are broken arbitrarily,
/// which is immaterial at this corpus size.
pub fn average_precision(points: &[(f64, bool)]) -> Option<f64> {
    let positives = points.iter().filter(|(_, expected)| *expected).count();
    if positives == 0 {
        return None;
    }
    let mut ranked = points.to_vec();
    ranked.sort_by(|a, b| b.0.total_cmp(&a.0));

    let mut seen = 0u32;
    let mut hits = 0u32;
    let mut precision_sum = 0.0;
    for (_, expected) in ranked {
        seen += 1;
        if expected {
            hits += 1;
            precision_sum += f64::from(hits) / f64::from(seen);
        }
    }
    Some(precision_sum / positives as f64)
}

/// Recall at cutoff `k`: the fraction of positives whose true match was
/// retrieved within the top `k` results. `ranks[i]` is the 0-based rank of the
/// i-th positive's true match, or `None` if it was not retrieved at all. `None`
/// when there are no positives.
pub fn recall_at_k(ranks: &[Option<usize>], k: usize) -> Option<f64> {
    if ranks.is_empty() {
        return None;
    }
    let hits = ranks
        .iter()
        .filter(|rank| rank.is_some_and(|rank| rank < k))
        .count();
    Some(hits as f64 / ranks.len() as f64)
}

/// Renders a threshold sweep as a table, plus the average precision and the
/// best-F1 operating point (the data-driven suggestion for the vector floor).
pub fn sweep_report(title: &str, points: &[(f64, bool)], thresholds: &[f64]) -> String {
    use std::fmt::Write as _;

    let sweep = threshold_sweep(points, thresholds);
    let positives = points.iter().filter(|(_, expected)| *expected).count();

    let mut out = String::new();
    let _ = writeln!(out, "\n===== {title} =====");
    let _ = writeln!(
        out,
        "{} pairs ({positives} duplicate, {} non-duplicate)  average_precision={}",
        points.len(),
        points.len() - positives,
        fmt_ratio(average_precision(points)),
    );
    let _ = writeln!(
        out,
        "\n threshold  precision     recall         f1   TP  FP  FN  TN"
    );
    for point in &sweep {
        let c = point.confusion;
        let _ = writeln!(
            out,
            "    {:>5.2}     {:>7}   {:>7}   {:>7}  {:>3} {:>3} {:>3} {:>3}",
            point.threshold,
            fmt_ratio(c.precision()),
            fmt_ratio(c.recall()),
            fmt_ratio(c.f1()),
            c.tp,
            c.fp,
            c.r#fn,
            c.tn,
        );
    }

    if let Some(best) = sweep
        .iter()
        .filter(|point| point.confusion.f1().is_some())
        .max_by(|a, b| {
            a.confusion
                .f1()
                .unwrap()
                .total_cmp(&b.confusion.f1().unwrap())
        })
    {
        let _ = writeln!(
            out,
            "\nbest F1 at threshold {:.2}: precision={} recall={} f1={}",
            best.threshold,
            fmt_ratio(best.confusion.precision()),
            fmt_ratio(best.confusion.recall()),
            fmt_ratio(best.confusion.f1()),
        );
    }
    out
}

/// A single pair's outcome, retained so the report can list the misses.
pub struct PairOutcome {
    /// First task id.
    pub a: String,
    /// Second task id.
    pub b: String,
    /// The scenario this pair exercises.
    pub case: PairCase,
    /// Ground-truth duplicate label.
    pub expected: bool,
    /// What the pipeline predicted.
    pub predicted: bool,
    /// Free-text detail (judge reason, vector score, or why it was not linked).
    pub detail: String,
}

/// Builds the full text report for a set of pair outcomes: overall confusion
/// matrix, per-case breakdown, and the list of misclassified pairs.
pub fn report(title: &str, outcomes: &[PairOutcome]) -> String {
    use std::collections::BTreeMap;
    use std::fmt::Write as _;

    let mut overall = Confusion::default();
    let mut by_case: BTreeMap<&'static str, Confusion> = BTreeMap::new();
    for outcome in outcomes {
        overall.record(outcome.expected, outcome.predicted);
        by_case
            .entry(outcome.case.label())
            .or_default()
            .record(outcome.expected, outcome.predicted);
    }

    let mut out = String::new();
    let _ = writeln!(out, "\n===== {title} =====");
    let _ = writeln!(
        out,
        "pairs: {}  TP={} FP={} FN={} TN={}",
        overall.total(),
        overall.tp,
        overall.fp,
        overall.r#fn,
        overall.tn,
    );
    let _ = writeln!(
        out,
        "precision={}  recall={}  f1={}  accuracy={}",
        fmt_ratio(overall.precision()),
        fmt_ratio(overall.recall()),
        fmt_ratio(overall.f1()),
        fmt_ratio(overall.accuracy()),
    );

    let _ = writeln!(out, "\nby case:");
    for (case, matrix) in &by_case {
        let correct = matrix.tp + matrix.tn;
        let _ = writeln!(
            out,
            "  {case:<34} {correct}/{} correct  (TP={} FP={} FN={} TN={})",
            matrix.total(),
            matrix.tp,
            matrix.fp,
            matrix.r#fn,
            matrix.tn,
        );
    }

    let misses: Vec<&PairOutcome> = outcomes
        .iter()
        .filter(|o| o.expected != o.predicted)
        .collect();
    if misses.is_empty() {
        let _ = writeln!(out, "\nno misclassifications.");
    } else {
        let _ = writeln!(out, "\nmisclassifications ({}):", misses.len());
        for miss in misses {
            let kind = if miss.expected {
                "MISSED DUP  "
            } else {
                "FALSE POS   "
            };
            let _ = writeln!(
                out,
                "  {kind}[{}] {} <> {}\n              {}",
                miss.case.label(),
                miss.a,
                miss.b,
                miss.detail,
            );
        }
    }
    out
}
