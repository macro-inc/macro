use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_search::names::{NameKind, NamedItem};
use readonly_pool::ReadOnlyPool;
use sqlx::PgPool;
use uuid::Uuid;

use super::{ChannelNames, exact_patterns};
use crate::domain::names::{Candidate, NameSource, NameViewer, Needle};

const VIEWER: &str = "macro|viewer@example.com";
const EXACT_CHANNEL: Uuid = Uuid::from_u128(0xe0e0);
const UNNAMED_CHANNEL: Uuid = Uuid::from_u128(0xa1b0);

fn needle(name: &str) -> Needle {
    Needle::parse(name).expect("a non-empty name")
}

async fn find(pool: PgPool, name: &str) -> Vec<Candidate> {
    let source = ChannelNames::new(ReadOnlyPool(pool));
    let viewer = NameViewer {
        user: MacroUserIdStr::try_from(VIEWER.to_string()).expect("viewer id"),
        team: None,
    };
    source
        .find(&viewer, &[NameKind::Channel], &[needle(name)])
        .await
        .expect("channels read")
}

#[test]
fn the_exact_pattern_escapes_the_name_and_allows_its_spacing() {
    assert_eq!(
        exact_patterns(&needle("#Q4 (launch)")),
        vec![r"^\s*[#@]?\s*q4\s+\(launch\)\s*$"]
    );
}

#[test]
fn each_comma_separated_part_is_anchored_at_a_comma_or_an_end() {
    assert_eq!(
        exact_patterns(&needle("Ada  Lovelace, Bob,, Carol")),
        vec![
            r"^\s*[#@]?\s*ada\s+lovelace\s*(,|$)",
            r"(^|,)\s*bob\s*(,|$)",
            r"(^|,)\s*carol\s*$",
        ]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_names"))
)]
async fn an_older_channel_named_exactly_is_found_behind_a_full_read(pool: PgPool) {
    let found = find(pool, "#launch").await;

    assert_eq!(found.len(), 101);
    let exact = found
        .iter()
        .find(|candidate| candidate.item == NamedItem::Channel { id: EXACT_CHANNEL })
        .expect("the channel named exactly");
    assert_eq!(exact.name, "Launch");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_names"))
)]
async fn an_older_unnamed_channel_is_found_by_its_members_behind_a_full_read(pool: PgPool) {
    let found = find(pool, "alice, bob").await;

    assert_eq!(found.len(), 101);
    let exact = found
        .iter()
        .find(|candidate| {
            candidate.item
                == NamedItem::Channel {
                    id: UNNAMED_CHANNEL,
                }
        })
        .expect("the channel its members name");
    assert_eq!(exact.name, "alice, bob");
}
