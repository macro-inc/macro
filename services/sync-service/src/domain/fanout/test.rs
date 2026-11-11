use super::*;

#[test]
fn merging_debts_preserves_incomparable_bases_and_all_required_history() {
    let first = FanoutDebt {
        base: VersionVector::from_iter([(1, 4), (2, 1)]).encode(),
        required: VersionVector::from_iter([(1, 7), (2, 3)]).encode(),
    };
    let second = FanoutDebt {
        base: VersionVector::from_iter([(1, 2), (3, 5)]).encode(),
        required: VersionVector::from_iter([(1, 6), (3, 6)]).encode(),
    };
    let (base, required) = first.merged_with(&second).unwrap().vectors().unwrap();
    assert_eq!(base, VersionVector::from_iter([(1, 2)]));
    assert_eq!(required, VersionVector::from_iter([(1, 7), (2, 3), (3, 6)]));
    assert_eq!(
        second.merged_with(&first).unwrap().vectors().unwrap(),
        (base, required)
    );
    assert_eq!(
        first.merged_with(&first).unwrap().vectors().unwrap(),
        first.vectors().unwrap()
    );
}

#[test]
fn merging_never_discards_a_malformed_or_impossible_debt() {
    let valid = FanoutDebt {
        base: VersionVector::new().encode(),
        required: VersionVector::from_iter([(1, 1)]).encode(),
    };
    for invalid in [
        FanoutDebt {
            base: vec![255],
            required: valid.required.clone(),
        },
        FanoutDebt {
            base: valid.base.clone(),
            required: vec![255],
        },
        FanoutDebt {
            base: VersionVector::from_iter([(1, 2)]).encode(),
            required: valid.required.clone(),
        },
    ] {
        assert!(invalid.merged_with(&valid).is_err());
        assert!(valid.merged_with(&invalid).is_err());
    }
}

#[test]
fn debt_keys_exclude_both_legacy_operation_prefixes() {
    assert!(!FANOUT_DEBT_KEY.starts_with("o/"));
    assert!(!FANOUT_DEBT_KEY.starts_with("a/"));
    assert!(is_fanout_debt_key(FANOUT_DEBT_KEY));
    assert!(is_fanout_debt_key(LEGACY_FANOUT_DEBT_KEY));
    assert!(!is_fanout_debt_key("o/operation"));
}
