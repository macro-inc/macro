use super::*;

#[test]
fn unknown_formats_cannot_silently_become_all_mail() {
    let rules = EmailRuleSet {
        schema_version: 2,
        include: Vec::new(),
    };
    assert!(matches!(
        rules.validate_shape(),
        Err(EmailRuleDefinitionError::UnsupportedVersion)
    ));
    assert!(
        serde_json::from_str::<EmailRuleSet>(r#"{"schema_version":1,"include":[],"enabled":true}"#)
            .is_err()
    );
}

#[test]
fn authoring_limit_is_checked_before_deduplication_or_live_resolution() {
    let mut rules = EmailRuleSet {
        schema_version: 1,
        include: vec![
            EmailInclusionRule::Contact {
                contact_id: Uuid::now_v7(),
            };
            500
        ],
    };
    rules.validate_shape().unwrap();
    rules.include.push(EmailInclusionRule::Company {
        company_id: Uuid::now_v7(),
    });
    assert!(matches!(
        rules.validate_shape(),
        Err(EmailRuleDefinitionError::TooManyRules)
    ));
}

#[test]
fn a_small_rule_count_cannot_bypass_the_byte_budget() {
    let rules = EmailRuleSet {
        schema_version: 1,
        include: vec![EmailInclusionRule::Address {
            address: "x".repeat(65_536),
        }],
    };
    assert!(matches!(
        rules.validate_shape(),
        Err(EmailRuleDefinitionError::TooLarge)
    ));
}

#[test]
fn explicit_empty_selection_is_valid() {
    EmailRuleSet {
        schema_version: 1,
        include: Vec::new(),
    }
    .validate_shape()
    .unwrap();
}
