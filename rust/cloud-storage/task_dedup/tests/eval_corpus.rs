//! Offline guards that run in normal CI (no API calls): the committed corpus is
//! well-formed and covers every scenario, and the metric math is correct.

mod eval;

use eval::corpus::load_corpus;
use eval::metrics::{
    Confusion, PairOutcome, average_precision, recall_at_k, report, threshold_sweep,
};
use task_dedup::eval::PairCase;

#[test]
fn corpus_fixtures_are_consistent() {
    // Guards the committed fixtures on every build so a bad edit (dangling pair
    // id, malformed JSON) fails fast without any API calls.
    let corpus = load_corpus();
    assert!(corpus.tasks.len() > 20, "expected a non-trivial corpus");
    assert!(!corpus.pairs.is_empty(), "expected labeled pairs");
    assert!(corpus.pairs.iter().any(|p| p.expected_duplicate));
    assert!(corpus.pairs.iter().any(|p| !p.expected_duplicate));

    // Every scenario the dedup spec calls out must have more than one labeled
    // pair, so per-case precision/recall isn't computed off a single example.
    for case in [
        PairCase::Rephrasing,
        PairCase::TerseVsDetailed,
        PairCase::LowLexicalOverlap,
        PairCase::SameProjectDifferentAction,
        PairCase::SameActionDifferentIntegration,
        PairCase::Unrelated,
    ] {
        let count = corpus.pairs.iter().filter(|p| p.case == case).count();
        assert!(
            count > 1,
            "scenario {} has only {count} pair(s)",
            case.label()
        );
    }
}

#[test]
fn confusion_computes_precision_recall_f1() {
    let mut c = Confusion::default();
    c.record(true, true); // tp
    c.record(true, true); // tp
    c.record(true, false); // fn
    c.record(false, true); // fp
    c.record(false, false); // tn

    assert_eq!((c.tp, c.fp, c.r#fn, c.tn), (2, 1, 1, 1));
    assert!((c.precision().unwrap() - 2.0 / 3.0).abs() < 1e-9);
    assert!((c.recall().unwrap() - 2.0 / 3.0).abs() < 1e-9);
    assert!((c.f1().unwrap() - 2.0 / 3.0).abs() < 1e-9);
    assert!((c.accuracy().unwrap() - 3.0 / 5.0).abs() < 1e-9);
}

#[test]
fn confusion_handles_empty_denominators() {
    let empty = Confusion::default();
    assert_eq!(empty.precision(), None);
    assert_eq!(empty.recall(), None);
    assert_eq!(empty.f1(), None);
    assert_eq!(empty.accuracy(), None);

    let mut only_negatives = Confusion::default();
    only_negatives.record(false, false);
    assert_eq!(only_negatives.precision(), None); // nothing predicted positive
    assert_eq!(only_negatives.recall(), None); // no real positives
}

#[test]
fn report_lists_misclassifications() {
    let outcomes = vec![
        PairOutcome {
            a: "a".into(),
            b: "b".into(),
            case: PairCase::Rephrasing,
            expected: true,
            predicted: false,
            detail: "not linked".into(),
        },
        PairOutcome {
            a: "c".into(),
            b: "d".into(),
            case: PairCase::Unrelated,
            expected: false,
            predicted: false,
            detail: "ok".into(),
        },
    ];
    let text = report("t", &outcomes);
    assert!(text.contains("MISSED DUP"));
    assert!(text.contains("rephrasing"));
    assert!(text.contains("misclassifications (1)"));
}

#[test]
fn threshold_sweep_tallies_each_cutoff() {
    let points = vec![
        (0.9, true),
        (0.8, true),
        (0.7, false),
        (0.6, true),
        (0.2, false),
    ];
    let sweep = threshold_sweep(&points, &[0.75, 0.5]);

    // At 0.75: 0.9,0.8 predicted dup (both real) -> tp=2; 0.6 real but below -> fn=1;
    // 0.7,0.2 non-dup and below -> tn=2.
    assert_eq!(
        (
            sweep[0].confusion.tp,
            sweep[0].confusion.fp,
            sweep[0].confusion.r#fn,
            sweep[0].confusion.tn
        ),
        (2, 0, 1, 2)
    );
    // At 0.5: 0.9,0.8,0.6 real+above -> tp=3; 0.7 non-dup above -> fp=1; 0.2 non-dup below -> tn=1.
    assert_eq!(
        (
            sweep[1].confusion.tp,
            sweep[1].confusion.fp,
            sweep[1].confusion.r#fn,
            sweep[1].confusion.tn
        ),
        (3, 1, 0, 1)
    );
}

#[test]
fn average_precision_ranks_positives() {
    // Positives at ranks 1,2,4 -> AP = (1/1 + 2/2 + 3/4) / 3.
    let points = vec![
        (0.9, true),
        (0.8, true),
        (0.7, false),
        (0.6, true),
        (0.2, false),
    ];
    let ap = average_precision(&points).unwrap();
    assert!((ap - (1.0 + 1.0 + 0.75) / 3.0).abs() < 1e-9);
    assert_eq!(average_precision(&[(0.5, false)]), None);
}

#[test]
fn recall_at_k_counts_hits_within_cutoff() {
    let ranks = [Some(0usize), Some(2), None];
    assert!((recall_at_k(&ranks, 1).unwrap() - 1.0 / 3.0).abs() < 1e-9);
    assert!((recall_at_k(&ranks, 3).unwrap() - 2.0 / 3.0).abs() < 1e-9);
    assert_eq!(recall_at_k(&[], 5), None);
}
