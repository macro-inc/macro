use super::*;

#[test]
fn matches_shared_browser_score_fixtures() {
    for line in include_str!("fixtures.tsv").lines().skip(1) {
        let fields: Vec<_> = line.split('\t').collect();
        let [label, text, query, gap, decay, expected, rank] = fields.as_slice() else {
            panic!("invalid fixture")
        };
        let actual = match_quality(
            label,
            text,
            query,
            gap.parse().unwrap(),
            decay.parse().unwrap(),
        );
        if *expected == "-" {
            assert!(actual.is_none(), "{line}");
        } else {
            assert!(
                (actual.unwrap() - expected.parse::<f64>().unwrap()).abs() < 1e-12,
                "{line}"
            );
        }
        assert_eq!(
            name_match_rank(label, query),
            rank.parse::<u8>().unwrap(),
            "{line}"
        );
    }
}

#[test]
fn recipient_tiers_match_the_browser_contract() {
    for line in include_str!("recipient-fixtures.tsv").lines().skip(1) {
        let fields: Vec<_> = line.split('\t').collect();
        let [text, email, query, rank] = fields.as_slice() else {
            panic!("invalid fixture")
        };
        assert_eq!(
            recipient_match_rank(text, (!email.is_empty()).then_some(*email), query),
            rank.parse::<u8>().unwrap(),
            "{line}"
        );
    }
}

#[test]
fn independent_blends_preserve_recency_and_boost_priorities() {
    let weights = Weights {
        fuzzy: 0.7,
        time: 0.7,
        brevity: 0.0,
        max_age_ms: 2_000.0,
        decay: 0.5,
        minimum_quality: 0.1,
    };
    let old = blend(1.0, 10, None, 1_000, weights, 1.0);
    let recent = blend(1.0, 10, Some(900), 1_000, weights, 1.0);
    assert!(recent > old);
    assert!(blend(1.0, 10, Some(900), 1_000, weights, 5.4) > recent);
    assert_eq!(old, 0.5);
    // Scoring an unrelated row cannot change an existing row's score.
    blend(0.4, 80, Some(900), 1_000, weights, 1.0);
    assert_eq!(blend(1.0, 10, None, 1_000, weights, 1.0), old);
}
