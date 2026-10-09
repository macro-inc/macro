use super::*;

const FEATURES: [(AiFeature, bool); 14] = [
    (AiFeature::Chat, true),
    (AiFeature::Memory, false),
    (AiFeature::Automation, true),
    (AiFeature::DynamicCompletionsApi, true),
    (AiFeature::ChatRename, false),
    (AiFeature::CallSummary, false),
    (AiFeature::ChannelBot, true),
    (AiFeature::AiProjection, false),
    (AiFeature::AiEditing, true),
    (AiFeature::Import, true),
    (AiFeature::AgentSession, true),
    (AiFeature::AgentRepositoryChoice, true),
    (AiFeature::Dictation, false),
    (AiFeature::ImageGeneration, true),
];

#[test]
fn enforcement_defaults_to_disabled() {
    assert_eq!(AiUsageEnforcement::default(), AiUsageEnforcement::Disabled);
    assert!(!AiUsageEnforcement::default().is_enabled());
    assert!(AiUsageEnforcement::Enabled.is_enabled());
}

#[test]
fn feature_classification_preserves_billing_policy() {
    for (feature, billable) in FEATURES {
        assert_eq!(is_billable_feature(feature), billable, "{feature:?}");
        assert_eq!(NON_BILLABLE_AI_FEATURES.contains(&feature), !billable);
    }
    assert_eq!(NON_BILLABLE_AI_FEATURES.len(), 5);
}

#[test]
fn counting_requires_enabled_policy_billable_feature_and_real_user() {
    let user = MacroUserIdStr::try_from("macro|quota-test@example.com").unwrap();
    // A separately parsed system identity must also be exempt, not just the static value.
    let system = MacroUserIdStr::try_from(SYSTEM_USER_ID.as_ref()).unwrap();

    for policy in [AiUsageEnforcement::Disabled, AiUsageEnforcement::Enabled] {
        for (feature, billable) in FEATURES {
            for (identity, is_system) in [(&user, false), (&system, true)] {
                let expected = policy.is_enabled() && billable && !is_system;
                assert_eq!(
                    policy.should_count(identity, feature),
                    expected,
                    "{policy:?}, {feature:?}, {identity:?}"
                );
            }
        }
    }
}
