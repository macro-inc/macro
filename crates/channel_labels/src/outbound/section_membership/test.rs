use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const ENG_API: Uuid = Uuid::from_u128(0x72000000_0000_0000_0000_000000000001);
const DM: Uuid = Uuid::from_u128(0x72000000_0000_0000_0000_000000000002);
const PLATFORM: Uuid = Uuid::from_u128(0x73000000_0000_0000_0000_000000000001);
const ENGINEERING: Uuid = Uuid::from_u128(0x73000000_0000_0000_0000_000000000002);
const MINE: Uuid = Uuid::from_u128(0x73000000_0000_0000_0000_000000000004);
const APIS: Uuid = Uuid::from_u128(0x73000000_0000_0000_0000_000000000005);

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(&format!("macro|{name}@example.com"))
        .unwrap()
        .into_owned()
}

fn sorted(mut ids: Vec<Uuid>) -> Vec<Uuid> {
    ids.sort();
    ids
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("section_membership"))
)]
async fn finds_team_personal_and_rule_sections_per_user(pool: PgPool) {
    let reader = PgChannelSectionMembership(pool);
    let users = [user("alice"), user("bob"), user("carol"), user("dave")];

    let membership = reader.memberships(ENG_API, &users).await.unwrap();

    assert_eq!(membership.built_in, Some(ChannelSection::TeamChannels));
    // Team sections reach team members only; personal ones their owner only.
    assert_eq!(
        sorted(membership.labels[&user("alice")].clone()),
        vec![PLATFORM, ENGINEERING]
    );
    assert_eq!(
        sorted(membership.labels[&user("carol")].clone()),
        vec![PLATFORM, ENGINEERING]
    );
    assert_eq!(
        sorted(membership.labels[&user("bob")].clone()),
        vec![MINE, APIS]
    );
    assert!(!membership.labels.contains_key(&user("dave")));
    assert_eq!(membership.favorites, HashSet::from([user("carol")]));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("section_membership"))
)]
async fn direct_messages_are_in_no_custom_section(pool: PgPool) {
    let reader = PgChannelSectionMembership(pool);

    let membership = reader
        .memberships(DM, &[user("bob"), user("dave")])
        .await
        .unwrap();

    assert_eq!(membership.built_in, Some(ChannelSection::DirectMessages));
    assert!(membership.labels.is_empty());
    assert_eq!(membership.favorites, HashSet::from([user("dave")]));
}
