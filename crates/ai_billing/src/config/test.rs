use super::*;

#[test]
fn deserialized_booleans_select_settlement_policy() {
    assert_eq!(
        serde_json::from_value::<AiUsageBilling>(serde_json::json!(true)).unwrap(),
        AiUsageBilling::Enabled
    );
    assert_eq!(
        serde_json::from_value::<AiUsageBilling>(serde_json::json!(false)).unwrap(),
        AiUsageBilling::Disabled
    );
    for value in [
        serde_json::json!("true"),
        serde_json::json!(1),
        serde_json::json!(null),
    ] {
        assert!(serde_json::from_value::<AiUsageBilling>(value).is_err());
    }
}

#[test]
fn default_policy_is_disabled() {
    assert_eq!(AiUsageBilling::default(), AiUsageBilling::Disabled);
    assert!(!AiUsageBilling::Disabled.is_enabled());
    assert!(AiUsageBilling::Enabled.is_enabled());
}

#[test]
fn pricing_values_deserialize_from_integers_and_validate() {
    let allowance: IncludedAllowanceCents =
        serde_json::from_value(serde_json::json!(2_000)).unwrap();
    assert_eq!(allowance.cents(), 2_000);
    let markup: OverageMarkupPercent = serde_json::from_value(serde_json::json!(5)).unwrap();
    assert_eq!(markup.percent(), 5);

    let negative = serde_json::from_value::<IncludedAllowanceCents>(serde_json::json!(-1))
        .unwrap_err()
        .to_string();
    assert!(
        negative.contains(AI_USAGE_INCLUDED_ALLOWANCE_CENTS),
        "{negative}"
    );
    let too_high = serde_json::from_value::<OverageMarkupPercent>(serde_json::json!(100))
        .unwrap_err()
        .to_string();
    assert!(
        too_high.contains(AI_USAGE_OVERAGE_MARKUP_PERCENT),
        "{too_high}"
    );

    // Absent, null, or non-integer values are configuration errors, never defaults.
    for value in [
        serde_json::json!(null),
        serde_json::json!("2000"),
        serde_json::json!(20.5),
        serde_json::json!(true),
    ] {
        assert!(serde_json::from_value::<IncludedAllowanceCents>(value.clone()).is_err());
        assert!(serde_json::from_value::<OverageMarkupPercent>(value).is_err());
    }
}

#[test]
fn raw_pricing_values_parse_and_validate() {
    let pricing = parse_ai_pricing(" 2000 ", "5").unwrap();
    assert_eq!(pricing.included_allowance_cents(), 2_000);
    assert_eq!(pricing.overage_markup_percent(), 5);

    for (allowance, markup, named) in [
        ("", "5", AI_USAGE_INCLUDED_ALLOWANCE_CENTS),
        ("twenty dollars", "5", AI_USAGE_INCLUDED_ALLOWANCE_CENTS),
        ("-1", "5", AI_USAGE_INCLUDED_ALLOWANCE_CENTS),
        ("2000", "", AI_USAGE_OVERAGE_MARKUP_PERCENT),
        ("2000", "5%", AI_USAGE_OVERAGE_MARKUP_PERCENT),
        ("2000", "100", AI_USAGE_OVERAGE_MARKUP_PERCENT),
        ("2000", "2.5", AI_USAGE_OVERAGE_MARKUP_PERCENT),
    ] {
        let error = parse_ai_pricing(allowance, markup).unwrap_err();
        assert!(
            format!("{error:?}").contains(named),
            "{allowance:?}/{markup:?}: {error:?}"
        );
    }
}
