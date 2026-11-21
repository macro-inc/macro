//! The membership functions against the source lists they replace.

use crate::outbound::pg_access_repo::queries::test_viewers::{MATRIX_STRANGER, matrix_viewers};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::collections::BTreeSet;
use uuid::Uuid;

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

/// The functions access statements check membership with.
const MEMBERSHIP_FUNCTIONS: [&str; 2] = [
    "entity_access_source_matches",
    "entity_access_viewer_sources",
];

/// A listing in the form the access listings use (`list_form_access`): the
/// grants whose source is one of the viewer's.
const LISTING: &str = r#"
    SELECT ea.entity_id, ea.access_level
    FROM entity_access ea
    WHERE ea.entity_type = 'form'
      AND ea.source_id = ANY(ARRAY(SELECT s.source FROM entity_access_viewer_sources($1, $2) s(source)))
"#;

/// `EXPLAIN (VERBOSE)` of a point check, the batched document statement,
/// which matches grants with `entity_access_source_matches`, and of
/// [`LISTING`] for a user and for a bot in its team.
#[allow(
    clippy::disallowed_methods,
    reason = "EXPLAIN of the statement file the code runs; the query macros take only a literal"
)]
async fn plans(pool: &PgPool) -> anyhow::Result<Vec<(&'static str, String)>> {
    const VIEWER: &str = "macro|viewer@corp.test";
    let point_check = format!(
        "EXPLAIN (VERBOSE)\n{}",
        include_str!("../document_access/documents_access.sql")
    );
    let listing = format!("EXPLAIN (VERBOSE) {LISTING}");

    let mut plans = vec![(
        "point check",
        sqlx::query_scalar::<_, String>(&point_check)
            .bind(vec![Uuid::new_v4()])
            .bind(VIEWER)
            .persistent(false)
            .fetch_all(pool)
            .await?
            .join("\n"),
    )];
    for (label, scope_team) in [
        ("listing, user", None),
        ("listing, bot", Some(Uuid::new_v4())),
    ] {
        let plan = sqlx::query_scalar::<_, String>(&listing)
            .bind(VIEWER)
            .bind(scope_team)
            .persistent(false)
            .fetch_all(pool)
            .await?
            .join("\n");
        plans.push((label, plan));
    }
    Ok(plans)
}

/// Each membership function a plan still calls, as `"<plan>: <function>"`.
fn membership_calls(plans: &[(&str, String)]) -> Vec<String> {
    plans
        .iter()
        .flat_map(|(label, plan)| {
            MEMBERSHIP_FUNCTIONS
                .iter()
                .filter(|function| plan.contains(*function))
                .map(move |function| format!("{label}: {function}"))
        })
        .collect()
}

/// Postgres inlines both membership functions into the statements that call
/// them, so their team and channel lookups are planned as index probes with
/// the rest of the statement. A call it can't see into runs as a separate
/// function call for every grant checked. The migration that creates the
/// functions says what keeps them inlined.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
#[allow(
    clippy::disallowed_methods,
    reason = "ALTER FUNCTION on the throwaway test database, built per function"
)]
async fn the_planner_inlines_the_membership_functions(pool: PgPool) -> anyhow::Result<()> {
    let inlined = plans(&pool).await?;
    let calls = membership_calls(&inlined);
    assert!(calls.is_empty(), "not inlined: {calls:?}\n{inlined:#?}");

    // A SET clause is one of the things that stop inlining; the plans then
    // name the functions, so the check above can fail.
    for function in [
        "entity_access_source_matches(text, text, uuid)",
        "entity_access_viewer_sources(text, uuid)",
    ] {
        let alter = format!("ALTER FUNCTION {function} SET work_mem = '4MB'");
        sqlx::query(&alter).execute(&pool).await?;
    }
    assert_eq!(
        membership_calls(&plans(&pool).await?),
        [
            "point check: entity_access_source_matches",
            "listing, user: entity_access_viewer_sources",
            "listing, bot: entity_access_viewer_sources",
        ]
    );
    Ok(())
}
