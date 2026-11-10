use super::*;

#[test]
fn debug_shows_the_link_id_but_no_address() {
    let link = Link {
        id: Uuid::from_u128(0x0195_f0a6_8a0e_7cc2_8f39_6f0b_5d6a_2e10),
        macro_id: MacroUserIdStr::try_from("macro|owner@example.com".to_owned()).unwrap(),
        fusionauth_user_id: "fa-user".to_owned(),
        email_address: EmailStr::try_from("inbox@example.com".to_owned()).unwrap(),
        provider: UserProvider::Gmail,
        is_sync_active: true,
        is_primary: false,
        needs_reauth: false,
        last_sync_error_at: None,
        created_at: DateTime::UNIX_EPOCH,
        updated_at: DateTime::UNIX_EPOCH,
    };

    let debug = format!("{link:?}");

    assert!(debug.contains("0195f0a6-8a0e-7cc2-8f39-6f0b5d6a2e10"));
    assert!(!debug.contains("example.com"));
}
