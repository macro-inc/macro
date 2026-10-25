use super::*;
use crate::domain::models::{WorkFeedCandidateRequest, WorkFeedSoupMode};
use crate::outbound::pg_soup_repo::work_feed::work_feed_soup_page;
use item_filters::ast::agent_session::AgentSessionVisibility;

fn work_request<'a>(
    filter: &'a EntityFilterAst,
    sources: &'a [SourceId],
    mode: WorkFeedSoupMode,
    only: Option<&'a [model_entity::Entity<'static>]>,
) -> WorkFeedCandidateRequest<'a> {
    WorkFeedCandidateRequest {
        user_id: MacroUserIdStr::parse_from_str(USER_1).unwrap(),
        limit: 50,
        mode,
        after: None,
        types: &[EntityType::AgentSession],
        filter: Some(filter),
        link_ids: &[],
        foreign_entity_sources: sources,
        hydratable: EVERYTHING,
        only,
    }
}

#[sqlx::test(
    fixtures(path = "../../../../../fixtures", scripts("notified_at")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn hidden_contexts_with_notifications_and_activity_stay_out_of_broad_feeds(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let (mine, _) = seed_agent_sessions(&pool).await?;
    let sources = sources();
    let include = EntityFilterAst {
        agent_session_filter: Some(Arc::new(Expr::val(AgentSessionLiteral::Include))),
        ..Default::default()
    };
    sqlx::query!(
        "INSERT INTO activity_events (id, actor_id, subject_id, action, entity_type, entity_id, occurred_at) VALUES ($1, $2, $2, 'edited', 'agent_session', $3, '2024-06-01 10:22:00+00')",
        Uuid::now_v7(), USER_1, mine.to_string(),
    ).execute(&pool).await?;
    let before = work_feed_soup_page(
        &pool,
        work_request(&include, &sources, WorkFeedSoupMode::Work, None),
    )
    .await?;
    assert_eq!(before.len(), 1);
    assert!(before[0].attention_at.is_some() && before[0].touched_at.is_some());
    sqlx::query!(
        "UPDATE agent_session SET visibility = 'hidden', for_warming = FALSE WHERE id = $1",
        mine
    )
    .execute(&pool)
    .await?;
    let notified =
        notified_soup_page(&pool, req(Some(&include), &[], &sources, EVERYTHING)).await?;
    assert!(!keys(&notified).contains(&(EntityType::AgentSession, mine.to_string())));
    for mode in [WorkFeedSoupMode::Work, WorkFeedSoupMode::Attention] {
        assert!(
            work_feed_soup_page(&pool, work_request(&include, &sources, mode, None))
                .await?
                .is_empty()
        );
    }
    let only = [EntityType::AgentSession.with_entity_string(mine.to_string())];
    assert!(
        work_feed_soup_page(
            &pool,
            work_request(&include, &sources, WorkFeedSoupMode::Work, Some(&only))
        )
        .await?
        .is_empty(),
        "internal by-ID recomputation does not reopen broad-list visibility"
    );
    let named = EntityFilterAst {
        agent_session_filter: Some(Arc::new(Expr::val(AgentSessionLiteral::Id(mine)))),
        ..Default::default()
    };
    assert_eq!(
        work_feed_soup_page(
            &pool,
            work_request(&named, &sources, WorkFeedSoupMode::Work, None)
        )
        .await?
        .len(),
        1
    );
    let notified = notified_soup_page(&pool, req(Some(&named), &[], &sources, EVERYTHING)).await?;
    assert!(keys(&notified).contains(&(EntityType::AgentSession, mine.to_string())));
    // Favorites add positive ID constraints to the view's existing filter.
    let favorite = EntityFilterAst {
        agent_session_filter: Some(Arc::new(Expr::And(
            Box::new(Expr::val(AgentSessionLiteral::Include)),
            Box::new(Expr::val(AgentSessionLiteral::Id(mine))),
        ))),
        ..Default::default()
    };
    assert_eq!(
        work_feed_soup_page(
            &pool,
            work_request(&favorite, &sources, WorkFeedSoupMode::Work, None)
        )
        .await?
        .len(),
        1
    );
    let excluded = EntityFilterAst {
        agent_session_filter: Some(Arc::new(Expr::And(
            Box::new(Expr::val(AgentSessionLiteral::Include)),
            Box::new(Expr::Not(Box::new(Expr::val(AgentSessionLiteral::Id(
                mine,
            ))))),
        ))),
        ..Default::default()
    };
    assert!(
        work_feed_soup_page(
            &pool,
            work_request(&excluded, &sources, WorkFeedSoupMode::Work, None)
        )
        .await?
        .is_empty()
    );
    Ok(())
}

/// Home's work feed leaves unlisted routine runs out even while they hold
/// attention, and a feed that does not exclude them still shows them.
#[sqlx::test(
    fixtures(path = "../../../../../fixtures", scripts("notified_at")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn unlisted_runs_with_notifications_stay_out_of_feeds_that_exclude_them(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let (mine, _) = seed_agent_sessions(&pool).await?;
    let sources = sources();
    sqlx::query!(
        "UPDATE agent_session SET source = 'routine', visibility = 'unlisted' WHERE id = $1",
        mine,
    )
    .execute(&pool)
    .await?;
    let include = EntityFilterAst {
        agent_session_filter: Some(Arc::new(Expr::val(AgentSessionLiteral::Include))),
        ..Default::default()
    };
    let without_runs = EntityFilterAst {
        agent_session_filter: Some(Arc::new(Expr::and(
            Expr::val(AgentSessionLiteral::Include),
            Expr::is_not(Expr::val(AgentSessionLiteral::Visibility(
                AgentSessionVisibility::Unlisted,
            ))),
        ))),
        ..Default::default()
    };
    assert_eq!(
        work_feed_soup_page(
            &pool,
            work_request(&include, &sources, WorkFeedSoupMode::Attention, None)
        )
        .await?
        .len(),
        1
    );
    for mode in [WorkFeedSoupMode::Work, WorkFeedSoupMode::Attention] {
        assert!(
            work_feed_soup_page(&pool, work_request(&without_runs, &sources, mode, None))
                .await?
                .is_empty()
        );
    }
    let notified =
        notified_soup_page(&pool, req(Some(&without_runs), &[], &sources, EVERYTHING)).await?;
    assert!(!keys(&notified).contains(&(EntityType::AgentSession, mine.to_string())));
    Ok(())
}
