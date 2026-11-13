//! The membership functions against the source lists they replace.

use crate::outbound::pg_access_repo::queries::test_viewers::{MATRIX_STRANGER, matrix_viewers};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::collections::BTreeSet;

/// Strings a grant could name that are no one's source: a channel id in
/// braces, a string that is not a uuid, and NULL.
const NON_SOURCES: [Option<&str>; 3] = [
    Some("{7a000000-0000-0000-0000-0000000000c1}"),
    Some("not-a-uuid"),
    None,
];

/// For every viewer kind, `entity_access_source_matches` holds for exactly
/// the strings in the old source list, and `entity_access_viewer_sources`
/// lists exactly that list.
#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("viewer_matrix"))
)]
async fn membership_matches_exactly_the_source_list(pool: PgPool) -> anyhow::Result<()> {
    // Every user, team, channel and bot id, and each channel id in uppercase.
    let mut probes: Vec<Option<String>> = sqlx::query_scalar!(
        r#"SELECT id AS "id!" FROM "User"
           UNION ALL SELECT id::text FROM team
           UNION ALL SELECT id::text FROM comms_channels
           UNION ALL SELECT upper(id::text) FROM comms_channels
           UNION ALL SELECT 'bot|' || id FROM bots
           ORDER BY 1"#
    )
    .fetch_all(&pool)
    .await?
    .into_iter()
    .map(Some)
    .collect();
    probes.push(Some(MATRIX_STRANGER.to_string()));
    probes.extend(NON_SOURCES.iter().map(|probe| probe.map(str::to_string)));

    let viewers = matrix_viewers(&pool).await?;
    for matrix_viewer in &viewers {
        let old: BTreeSet<&str> = matrix_viewer.sources.0.iter().map(String::as_str).collect();
        let viewer = matrix_viewer.viewer();
        for probe in &probes {
            let matched = sqlx::query_scalar!(
                r#"SELECT EXISTS (SELECT FROM entity_access_source_matches($1, $2, $3)) AS "matched!""#,
                probe.as_deref(),
                viewer.id(),
                viewer.scope_team(),
            )
            .fetch_one(&pool)
            .await?;
            assert_eq!(
                matched,
                probe.as_deref().is_some_and(|probe| old.contains(probe)),
                "{} on {probe:?}",
                matrix_viewer.label
            );
        }

        if viewer.is_anonymous() {
            assert!(old.is_empty(), "{} had sources", matrix_viewer.label);
        }
        let listed: Vec<Option<String>> = sqlx::query_scalar!(
            r#"SELECT s.source FROM entity_access_viewer_sources($1, $2) s(source)"#,
            viewer.id(),
            viewer.scope_team(),
        )
        .fetch_all(&pool)
        .await?;
        assert_eq!(
            listed.iter().map(Option::as_deref).collect::<BTreeSet<_>>(),
            old.iter().copied().map(Some).collect::<BTreeSet<_>>(),
            "{}",
            matrix_viewer.label
        );
    }

    anyhow::ensure!(
        viewers
            .iter()
            .filter(|viewer| viewer.sources.0.len() > 2)
            .count()
            >= 2,
        "the fixture gave too few viewers memberships"
    );
    Ok(())
}
