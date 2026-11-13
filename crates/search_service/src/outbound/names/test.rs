use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_search::names::{NameKind, NamedItem};
use readonly_pool::ReadOnlyPool;
use sqlx::PgPool;
use uuid::Uuid;

use super::{ChannelNames, exact_pattern};
use crate::domain::names::{NameSource, NameViewer, Needle};

const VIEWER: &str = "macro|viewer@example.com";
const EXACT_CHANNEL: Uuid = Uuid::from_u128(0xe0e0);

fn needle(name: &str) -> Needle {
    Needle::parse(name).expect("a non-empty name")
}

#[test]
fn the_exact_pattern_escapes_the_name_and_allows_its_spacing() {
    assert_eq!(
        exact_pattern(&needle("#Q4 (launch)")),
        r"^\s*[#@]?\s*q4\s+\(launch\)\s*$"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("channel_names"))
)]
async fn an_older_channel_named_exactly_is_found_behind_a_full_read(pool: PgPool) {
    let source = ChannelNames::new(ReadOnlyPool(pool));
    let viewer = NameViewer {
        user: MacroUserIdStr::try_from(VIEWER.to_string()).expect("viewer id"),
        team: None,
    };

    let found = source
        .find(&viewer, &[NameKind::Channel], &[needle("#launch")])
        .await
        .expect("channels read");

    assert_eq!(found.len(), 101);
    let exact = found
        .iter()
        .find(|candidate| candidate.item == NamedItem::Channel { id: EXACT_CHANNEL })
        .expect("the channel named exactly");
    assert_eq!(exact.name, "Launch");
}
