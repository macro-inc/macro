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
        RoleId::SubMax,
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

#[test]
fn max_role_roundtrips_through_its_string_id() {
    assert_eq!(RoleId::SubMax.to_string(), "sub_max");
    assert_eq!("sub_max".parse::<RoleId>().unwrap(), RoleId::SubMax);
}
