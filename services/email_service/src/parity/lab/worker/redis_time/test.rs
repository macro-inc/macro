use super::*;

const WINDOW: &str = "gmail:{51000000-0000-0000-0000-00000000f61e}:window";
const RULES: &[RedisRule] = &[RedisRule::GmailGateWindowTotalUnits];

#[test]
fn mask_gate_timestamps_without_dropping_units_caps_or_members() {
    let before = BTreeMap::from([
        (WINDOW.into(), json!({"1700000000":"5"})),
        ("ordinary".into(), json!({"1700000000":"5"})),
    ]);
    let after = BTreeMap::from([
        (WINDOW.into(), json!({"1700000000":"10","1700000001":"5"})),
        (
            "gmail:{id}:limit".into(),
            json!({"at":"1700000001000","cap":"3"}),
        ),
        (
            "gmail:{id}:inflight".into(),
            json!([["permit", 1700000091000_i64]]),
        ),
        ("ordinary".into(), json!({"1700000001":"5"})),
    ]);
    let actual = changes(before, after, RULES);
    assert_eq!(
        actual[WINDOW],
        json!({"before":{"<total_units>":"5"},"after":{"<total_units>":"15"}})
    );
    assert_eq!(
        actual["gmail:{id}:limit"]["after"],
        json!({"at":"<timestamp>","cap":"3"})
    );
    assert_eq!(
        actual["gmail:{id}:inflight"]["after"],
        json!([["permit", "<timestamp>"]])
    );
    assert_eq!(
        actual["ordinary"],
        json!({"before":{"1700000000":"5"},"after":{"1700000001":"5"}})
    );
}

#[test]
fn window_rule_pins_total_units_instead_of_per_second_split() {
    let render = |fields| {
        changes(
            BTreeMap::new(),
            BTreeMap::from([(WINDOW.into(), fields)]),
            RULES,
        )
    };
    let one_bucket = render(json!({"1700000000":"10"}));
    assert_eq!(
        one_bucket,
        render(json!({"1700000000":"5","1700000001":"5"}))
    );
    assert_ne!(
        one_bucket,
        render(json!({"1700000000":"5","1700000001":"6"}))
    );
    assert_eq!(one_bucket[WINDOW]["after"], json!({"<total_units>":"10"}));
}

#[test]
fn window_rule_is_opt_in_exactly_scoped_and_preserves_other_fields() {
    let fields = json!({"1700000000":"10","cap":"2300","unexpected":[1,2]});
    let mut after = BTreeMap::from([(WINDOW.into(), fields.clone())]);
    let other_keys = [
        "ordinary",
        "prefix:gmail:{51000000-0000-0000-0000-00000000f61e}:window",
        "gmail:{51000000-0000-0000-0000-00000000f61e}:window:suffix",
        "gmail:{id}:window",
        "gmail:{51000000-0000-0000-0000-00000000F61E}:window",
        "gmail:{51000000-0000-0000-0000-00000000f61e}:other",
    ];
    for key in other_keys {
        after.insert(key.into(), fields.clone());
    }
    assert_eq!(
        changes(BTreeMap::new(), after.clone(), &[])[WINDOW]["after"],
        fields
    );
    let actual = changes(BTreeMap::new(), after, RULES);
    assert_eq!(
        actual[WINDOW]["after"],
        json!({"<total_units>":"10","cap":"2300","unexpected":[1,2]})
    );
    for key in other_keys {
        assert_eq!(actual[key]["after"], fields, "{key}");
    }
}

#[test]
fn redis_diff_ignores_only_redistribution_with_the_same_window_total() {
    let before = BTreeMap::from([(WINDOW.into(), json!({"1700000000":"10"}))]);
    let after = BTreeMap::from([(WINDOW.into(), json!({"1700000000":"5","1700000001":"5"}))]);
    assert_eq!(changes(before, after, RULES), json!({}));
}
