//! The batched pipeline check gives every pipeline the answer the
//! one-pipeline check gives it: the highest of the reader's grants on it,
//! counting only `crm_pipeline` grants through the reader's own sources.

use super::*;
// Ordered maps, so a failed comparison lists pipelines in order.
use std::collections::BTreeMap;

const READERS: [&str; 4] = [TEAM_MEMBER, TEAM_ADMIN, TEAM_BETA_OWNER, USER_WITHOUT_TEAM];

fn pipeline(n: u8) -> Uuid {
    Uuid::parse_str(&format!("c1000000-0000-0000-0000-{n:012}")).unwrap()
}

/// One grant row.
async fn grant(
    pool: &PgPool,
    entity: Uuid,
    entity_type: &str,
    source: &str,
    source_type: &str,
    level: &str,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO entity_access (entity_id, entity_type, source_id, source_type, access_level)
           VALUES ($1, $2, $3, $4::text::entity_access_source_type, $5::text::"AccessLevel")"#,
        entity,
        entity_type,
        source,
        source_type,
        level,
    )
    .execute(pool)
    .await?;
    Ok(())
}

/// The pipelines asked for, out of order, with a repeat and one without grants.
fn requested() -> Vec<Uuid> {
    vec![
        pipeline(5),
        pipeline(3),
        pipeline(1),
        pipeline(2),
        pipeline(4),
        pipeline(7),
        pipeline(1),
    ]
}

async fn one_at_a_time(
    repo: &PgAccessRepository,
    ids: &[Uuid],
    reader: &str,
) -> anyhow::Result<BTreeMap<Uuid, AccessLevel>> {
    let reader = user_id(reader);
    let mut levels = BTreeMap::new();
    for id in ids {
        if let Some(level) = repo
            .get_pipeline_access(&id.to_string(), Some(&reader))
            .await?
        {
            levels.insert(*id, level);
        }
    }
    Ok(levels)
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../fixtures", scripts("user_team"))
)]
async fn pipelines_access_matches_one_pipeline_at_a_time(pool: PgPool) -> anyhow::Result<()> {
    // Two grants each, written in opposite orders: whichever order they come
    // back in, keeping the first or the last grant loses the higher one on
    // one of these pipelines.
    grant(
        &pool,
        pipeline(1),
        "crm_pipeline",
        TEAM_MEMBER,
        "user",
        "view",
    )
    .await?;
    grant(
        &pool,
        pipeline(1),
        "crm_pipeline",
        TEAM_ALPHA,
        "team",
        "edit",
    )
    .await?;
    grant(
        &pool,
        pipeline(2),
        "crm_pipeline",
        TEAM_ALPHA,
        "team",
        "edit",
    )
    .await?;
    grant(
        &pool,
        pipeline(2),
        "crm_pipeline",
        TEAM_MEMBER,
        "user",
        "view",
    )
    .await?;
    // The owner of a pipeline shared with the team.
    grant(
        &pool,
        pipeline(3),
        "crm_pipeline",
        TEAM_MEMBER,
        "user",
        "owner",
    )
    .await?;
    grant(
        &pool,
        pipeline(3),
        "crm_pipeline",
        TEAM_ALPHA,
        "team",
        "edit",
    )
    .await?;
    // A grant of another entity type on the same id counts for nothing.
    grant(&pool, pipeline(4), "document", TEAM_MEMBER, "user", "owner").await?;
    grant(
        &pool,
        pipeline(4),
        "crm_pipeline",
        TEAM_ALPHA,
        "team",
        "view",
    )
    .await?;
    // Grants through another user's and another team's sources only.
    grant(
        &pool,
        pipeline(5),
        "crm_pipeline",
        TEAM_BETA_OWNER,
        "user",
        "owner",
    )
    .await?;
    grant(
        &pool,
        pipeline(5),
        "crm_pipeline",
        TEAM_BETA,
        "team",
        "edit",
    )
    .await?;
    // A grant on a pipeline nobody asks about.
    grant(
        &pool,
        pipeline(6),
        "crm_pipeline",
        TEAM_MEMBER,
        "user",
        "edit",
    )
    .await?;
    grant(
        &pool,
        pipeline(6),
        "crm_pipeline",
        TEAM_BETA,
        "team",
        "edit",
    )
    .await?;
    let repo = PgAccessRepository::new(pool);

    for reader in READERS {
        let batch: BTreeMap<_, _> = repo
            .get_pipelines_access(&requested(), &user_id(reader))
            .await?
            .into_iter()
            .collect();
        assert_eq!(
            batch,
            one_at_a_time(&repo, &requested(), reader).await?,
            "{reader}"
        );
    }

    let member = repo
        .get_pipelines_access(&requested(), &user_id(TEAM_MEMBER))
        .await?;
    assert_eq!(
        member.into_iter().collect::<BTreeMap<_, _>>(),
        BTreeMap::from([
            (pipeline(1), AccessLevel::Edit),
            (pipeline(2), AccessLevel::Edit),
            (pipeline(3), AccessLevel::Owner),
            (pipeline(4), AccessLevel::View),
        ])
    );
    let beta = repo
        .get_pipelines_access(&requested(), &user_id(TEAM_BETA_OWNER))
        .await?;
    assert_eq!(
        beta.into_iter().collect::<BTreeMap<_, _>>(),
        BTreeMap::from([(pipeline(5), AccessLevel::Owner)])
    );
    assert!(
        repo.get_pipelines_access(&requested(), &user_id(USER_WITHOUT_TEAM))
            .await?
            .is_empty()
    );
    assert!(
        repo.get_pipelines_access(&[], &user_id(TEAM_MEMBER))
            .await?
            .is_empty()
    );
    Ok(())
}
