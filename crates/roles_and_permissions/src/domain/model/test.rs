use super::RoleId;

#[test]
fn paid_subscription_roles_include_legacy_and_pricing_tiers() {
    for role in [
        RoleId::ProfessionalSubscriber,
        RoleId::TeamSubscriber,
        RoleId::Corporate,
        RoleId::SubHaiku,
        RoleId::SubSonnet,
        RoleId::SubOpus,
    ] {
        assert!(
            role.is_paid_subscription(),
            "{role} should have paid access"
        );
    }
}

#[test]
fn non_subscription_roles_do_not_grant_paid_access() {
    for role in [
        RoleId::SelfServe,
        RoleId::SuperAdmin,
        RoleId::AiSubscriber,
        RoleId::EditorUser,
    ] {
        assert!(
            !role.is_paid_subscription(),
            "{role} should not grant paid access"
        );
    }
}
