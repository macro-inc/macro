use super::*;

#[derive(serde::Deserialize)]
struct IdentityFixture {
    viewer: String,
    user: String,
    id: Uuid,
}

#[test]
fn directory_identity_matches_the_offline_client_contract() {
    let fixtures: Vec<IdentityFixture> =
        serde_json::from_str(include_str!("identity-fixtures.json")).unwrap();
    for fixture in fixtures {
        let viewer = MacroUserIdStr::try_from(fixture.viewer).unwrap();
        let user = MacroUserIdStr::try_from(fixture.user).unwrap();
        assert_eq!(ContactId::for_viewer(&viewer, &user).as_uuid(), fixture.id);
    }
}
