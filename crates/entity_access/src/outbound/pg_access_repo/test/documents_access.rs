//! The batched document check gives every document the answer the
//! one-document check gives it. The fixture holds one document per way that
//! check grants or refuses access.

use super::*;
use crate::domain::{
    models::ViewAccessLevel, ports::EntityAccessService, service::EntityAccessServiceImpl,
};
// Ordered maps, so a failed comparison lists documents in order.
use std::collections::BTreeMap;

const VIEWER: &str = "macro|viewer@batch.test";
const TEAMMATE: &str = "macro|teammate@batch.test";
const STRANGER: &str = "macro|stranger@batch.test";
const OUTSIDER: &str = "macro|outsider@batch.test";
const READERS: [&str; 4] = [VIEWER, TEAMMATE, STRANGER, OUTSIDER];

fn document(n: u8) -> String {
    format!("d0000000-0000-0000-0000-{n:012}")
}

/// Every fixture document, out of order, plus a repeated id and an uppercase
/// spelling of one: each spelling gets its own answer, as it would one at a time.
fn requested_ids() -> Vec<String> {
    let mut ids: Vec<String> = (1..=26).rev().map(document).collect();
    ids.extend(["legacy-owned", "legacy-public", "legacy-missing"].map(String::from));
    ids.push(document(2));
    ids.push(document(3).to_uppercase());
    ids
}

async fn one_at_a_time(
    repo: &PgAccessRepository,
    ids: &[String],
    reader: &str,
) -> anyhow::Result<BTreeMap<String, AccessLevel>> {
    let reader = user_id(reader);
    let mut levels = BTreeMap::new();
    for id in ids {
        if let Some(level) = repo.get_document_access(id, Some(&reader)).await? {
            levels.insert(id.clone(), level);
        }
    }
    Ok(levels)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_access"))
)]
async fn batch_matches_one_at_a_time_for_every_reader(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgAccessRepository::new(pool);
    let ids = requested_ids();
    for reader in READERS {
        let expected = one_at_a_time(&repo, &ids, reader).await?;
        let batched: BTreeMap<_, _> = repo
            .get_documents_access(&ids, &user_id(reader))
            .await?
            .into_iter()
            .collect();
        assert_eq!(batched, expected, "reader {reader}");
    }
    assert!(
        repo.get_documents_access(&[], &user_id(VIEWER))
            .await?
            .is_empty()
    );
    Ok(())
}

/// Pins what the viewer gets from each source, so the comparison above is
/// never between two empty answers.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_access"))
)]
async fn batch_reaches_every_source(pool: PgPool) -> anyhow::Result<()> {
    let repo = PgAccessRepository::new(pool);
    let levels: BTreeMap<_, _> = repo
        .get_documents_access(&requested_ids(), &user_id(VIEWER))
        .await?
        .into_iter()
        .collect();

    let mut expected: BTreeMap<String, AccessLevel> = [
        (1, AccessLevel::Owner),
        (2, AccessLevel::View),
        (3, AccessLevel::Edit),
        (4, AccessLevel::Comment),
        (5, AccessLevel::Edit),
        (7, AccessLevel::Comment),
        (9, AccessLevel::View),
        (11, AccessLevel::Edit),
        (12, AccessLevel::Edit),
        (13, AccessLevel::View),
        (15, AccessLevel::View),
        (16, AccessLevel::View),
        (17, AccessLevel::View),
        (18, AccessLevel::View),
        (22, AccessLevel::Owner),
        (24, AccessLevel::View),
    ]
    .into_iter()
    .map(|(n, level)| (document(n), level))
    .collect();
    expected.insert("legacy-owned".into(), AccessLevel::Owner);
    expected.insert("legacy-public".into(), AccessLevel::View);
    expected.insert(document(3).to_uppercase(), AccessLevel::Edit);

    assert_eq!(levels, expected);
    Ok(())
}

/// The service's batched receipts are the receipts it hands out one at a time,
/// and a refused document gets none.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_access"))
)]
async fn batched_receipts_match_single_receipts(pool: PgPool) -> anyhow::Result<()> {
    let service = EntityAccessServiceImpl::new(PgAccessRepository::new(pool));
    let ids = requested_ids();
    for reader in READERS {
        let reader_id = user_id(reader);
        let mut expected = BTreeMap::new();
        for id in &ids {
            match service
                .generate_entity_access_receipt::<ViewAccessLevel>(
                    &reader_id,
                    None,
                    id,
                    EntityType::Document,
                )
                .await
            {
                Ok(receipt) => {
                    expected.insert(id.clone(), format!("{receipt:?}"));
                }
                Err(AccessError::Unauthorized) => {}
                Err(error) => return Err(error.into()),
            }
        }
        let batched: BTreeMap<String, String> = service
            .generate_document_view_access_receipts(&reader_id, &ids)
            .await?
            .into_iter()
            .map(|(id, receipt)| (id, format!("{receipt:?}")))
            .collect();
        assert_eq!(batched, expected, "reader {reader}");
    }
    Ok(())
}

/// More documents than one statement checks: every batch's grants come back.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("documents_access"))
)]
async fn batch_spans_several_statements(pool: PgPool) -> anyhow::Result<()> {
    let ids: Vec<Uuid> = (0..2 * super::super::DOCUMENTS_PER_ACCESS_STATEMENT + 50)
        .map(|_| Uuid::now_v7())
        .collect();
    let granted: Vec<Uuid> = ids.iter().copied().step_by(7).collect();
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           SELECT id, 'document', $2, 'user', 'view' FROM unnest($1::uuid[]) AS id"#,
        &granted,
        VIEWER,
    )
    .execute(&pool)
    .await?;
    let repo = PgAccessRepository::new(pool);

    let mut requested: Vec<String> = ids.iter().map(Uuid::to_string).collect();
    requested.push(document(1));
    let levels: BTreeMap<_, _> = repo
        .get_documents_access(&requested, &user_id(VIEWER))
        .await?
        .into_iter()
        .collect();

    let mut expected: BTreeMap<String, AccessLevel> = granted
        .iter()
        .map(|id| (id.to_string(), AccessLevel::View))
        .collect();
    expected.insert(document(1), AccessLevel::Owner);
    assert_eq!(levels, expected);
    Ok(())
}
