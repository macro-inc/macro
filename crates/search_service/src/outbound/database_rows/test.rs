//! The exposure gate against Postgres: what the index proposes is fixed per
//! test (it may be stale), and every row shown is checked in the database.

use std::collections::HashSet;
use std::sync::Arc;

use chrono::DateTime;
use entity_access::domain::models::CurrentSources;
use entity_access::domain::service::EntityAccessServiceImpl;
use entity_access::outbound::PgAccessRepository;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use models_search::database_row::DatabaseRowSearchResponseItem;
use rootcause::Report;
use sqlx::PgPool;
use uuid::{Uuid, uuid};

use super::DatabaseRowPgSource;
use crate::domain::database_rows::{
    CurrentRow, DatabaseRowSearch, DatabaseRowSource, ProposalRequest, ProposedRow, RowMatchType,
    RowPage, RowPosition, RowQuery,
};

const ACCOUNTS: Uuid = uuid!("10000000-0000-7000-8000-000000000001");
const ARCHIVE: Uuid = uuid!("10000000-0000-7000-8000-000000000002");
const CRM_STORAGE: Uuid = uuid!("10000000-0000-7000-8000-000000000003");
const CUSTOMERS: Uuid = uuid!("20000000-0000-7000-8000-000000000001");
const ACME_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000001");
const GLOBEX_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000002");
const ARCHIVED_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000003");
const CRM_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000004");
const DELETED_ROW: Uuid = uuid!("60000000-0000-7000-8000-000000000099");

/// Postgres for everything that decides what is shown, and a fixed list of
/// proposals standing in for the index, which matched them on text it held
/// when they were written: every one claims to match "acme".
struct StaleIndex {
    postgres: DatabaseRowPgSource,
    /// Each proposed row and the database the index files it under.
    proposals: Vec<(Uuid, Uuid)>,
}

impl DatabaseRowSource for StaleIndex {
    type Viewer = CurrentSources;

    async fn viewer(&self, user: &MacroUserId<Lowercase<'_>>) -> Result<CurrentSources, Report> {
        self.postgres.viewer(user).await
    }

    async fn viewable_database_ids(&self, viewer: &CurrentSources) -> Result<Vec<Uuid>, Report> {
        self.postgres.viewable_database_ids(viewer).await
    }

    async fn most_recent_databases(
        &self,
        database_ids: &[Uuid],
        limit: usize,
    ) -> Result<Vec<Uuid>, Report> {
        self.postgres
            .most_recent_databases(database_ids, limit)
            .await
    }

    async fn propose(&self, request: ProposalRequest<'_>) -> Result<Vec<ProposedRow>, Report> {
        // The index honours the database filter and resumes after `after`,
        // in its order: the order of `proposals`.
        let proposed: Vec<ProposedRow> = self
            .proposals
            .iter()
            .enumerate()
            .filter(|(_, (_, database_id))| request.database_ids.contains(database_id))
            .map(|(index, (row_id, _))| ProposedRow {
                row_id: *row_id,
                position: position(index, *row_id),
            })
            .collect();
        let start = match request.after {
            None => 0,
            Some(after) => proposed
                .iter()
                .position(|row| row.position == after)
                .map_or(proposed.len(), |index| index + 1),
        };
        Ok(proposed
            .into_iter()
            .skip(start)
            .take(request.limit as usize)
            .collect())
    }

    async fn viewable_rows(
        &self,
        viewer: &CurrentSources,
        row_ids: &[Uuid],
    ) -> Result<HashSet<Uuid>, Report> {
        self.postgres.viewable_rows(viewer, row_ids).await
    }

    async fn current_rows(&self, row_ids: &[Uuid]) -> Result<Vec<CurrentRow>, Report> {
        self.postgres.current_rows(row_ids).await
    }
}

/// The index's order: newest first.
fn position(index: usize, row_id: Uuid) -> RowPosition {
    RowPosition {
        updated_at: DateTime::from_timestamp_millis(1_763_000_000_000 - index as i64 * 1000)
            .expect("time"),
        row_id,
    }
}

fn source(pool: &PgPool, proposals: Vec<(Uuid, Uuid)>) -> StaleIndex {
    StaleIndex {
        postgres: DatabaseRowPgSource {
            primary_db: pool.clone(),
            entity_access: Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
                pool.clone(),
            ))),
            // Never called: `StaleIndex` proposes in its place.
            opensearch: Arc::new(
                opensearch_client::OpensearchClient::new(
                    "http://127.0.0.1:1".to_string(),
                    String::new(),
                    String::new(),
                )
                .expect("client"),
            ),
        },
        proposals,
    }
}

/// Every row the stale index holds for "acme".
fn every_acme_proposal() -> Vec<(Uuid, Uuid)> {
    vec![
        (ACME_ROW, ACCOUNTS),
        (GLOBEX_ROW, ACCOUNTS),
        (ARCHIVED_ROW, ARCHIVE),
        (CRM_ROW, CRM_STORAGE),
        (DELETED_ROW, ACCOUNTS),
    ]
}

async fn search(pool: &PgPool, email: &str, query: &str, limit: u32) -> RowPage {
    search_after(pool, email, query, limit, None).await
}

async fn search_after(
    pool: &PgPool,
    email: &str,
    query: &str,
    limit: u32,
    after: Option<RowPosition>,
) -> RowPage {
    let terms: Vec<String> = query.split_whitespace().map(str::to_string).collect();
    let row_query = RowQuery::new(&terms, RowMatchType::Partial).expect("query");
    let user_id = format!("macro|{email}");
    let user = MacroUserId::parse_from_str(&user_id)
        .expect("user id")
        .lowercase();
    DatabaseRowSearch(source(pool, every_acme_proposal()))
        .page(&user, &row_query, &terms, limit, after)
        .await
        .expect("search")
}

fn shown(page: &RowPage) -> Vec<Uuid> {
    page.rows.iter().map(|row| row.item.row_id).collect()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn shows_only_live_rows_whose_current_text_matches(pool: PgPool) {
    let page = search(&pool, "owner@example.com", "acme", 10).await;

    // Globex is proposed but only links Acme: a target's name never counts.
    // The archived row is in the Trash, the CRM row has no database entity,
    // and the deleted row is gone.
    assert_eq!(
        page.rows
            .iter()
            .map(|row| row.item.clone())
            .collect::<Vec<_>>(),
        vec![DatabaseRowSearchResponseItem {
            database_id: ACCOUNTS,
            table_id: CUSTOMERS,
            row_id: ACME_ROW,
            database_name: "Accounts".to_string(),
            table_name: "Customers".to_string(),
            title: "Acme Corp".to_string(),
            snippet: Some("Renewal with <macro_em>Acme</macro_em> due in May".to_string()),
            updated_at: "2026-11-20T10:00:00Z".parse().expect("time"),
        }]
    );
    assert_eq!(page.next, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn every_kind_of_grant_shows_the_row(pool: PgPool) {
    for email in [
        "viewer@example.com",
        "teammate@example.com",
        "channel@example.com",
        "folder@example.com",
        "responder@example.com",
    ] {
        let page = search(&pool, email, "acme", 10).await;
        assert_eq!(shown(&page), vec![ACME_ROW], "{email}");
    }

    let stranger = search(&pool, "stranger@example.com", "acme", 10).await;
    assert!(stranger.rows.is_empty());
    assert_eq!(stranger.next, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn a_revoked_share_hides_the_row(pool: PgPool) {
    assert_eq!(
        shown(&search(&pool, "viewer@example.com", "acme", 10).await),
        vec![ACME_ROW]
    );

    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id = $1 AND source_id = 'macro|viewer@example.com'",
        ACCOUNTS
    )
    .execute(&pool)
    .await
    .expect("revoke");

    assert!(
        search(&pool, "viewer@example.com", "acme", 10)
            .await
            .rows
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn leaving_the_team_hides_the_row_at_once(pool: PgPool) {
    assert_eq!(
        shown(&search(&pool, "teammate@example.com", "acme", 10).await),
        vec![ACME_ROW]
    );

    sqlx::query!("DELETE FROM team_user WHERE user_id = 'macro|teammate@example.com'")
        .execute(&pool)
        .await
        .expect("leave team");

    assert!(
        search(&pool, "teammate@example.com", "acme", 10)
            .await
            .rows
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn leaving_the_channel_hides_the_row_at_once(pool: PgPool) {
    assert_eq!(
        shown(&search(&pool, "channel@example.com", "acme", 10).await),
        vec![ACME_ROW]
    );

    sqlx::query!("UPDATE comms_channel_participants SET left_at = now() WHERE user_id = 'macro|channel@example.com'")
        .execute(&pool)
        .await
        .expect("leave channel");

    assert!(
        search(&pool, "channel@example.com", "acme", 10)
            .await
            .rows
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn moving_out_of_the_folder_hides_the_row(pool: PgPool) {
    assert_eq!(
        shown(&search(&pool, "folder@example.com", "acme", 10).await),
        vec![ACME_ROW]
    );

    // Moving a database out of a folder removes the grants it inherited there.
    sqlx::query!(
        "DELETE FROM entity_access WHERE entity_id = $1 AND granted_from_project_id IS NOT NULL",
        ACCOUNTS
    )
    .execute(&pool)
    .await
    .expect("move out of folder");

    assert!(
        search(&pool, "folder@example.com", "acme", 10)
            .await
            .rows
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn a_form_that_stops_sharing_responses_hides_the_row(pool: PgPool) {
    assert_eq!(
        shown(&search(&pool, "responder@example.com", "acme", 10).await),
        vec![ACME_ROW]
    );

    sqlx::query!("UPDATE forms SET responses_visible = false")
        .execute(&pool)
        .await
        .expect("stop sharing responses");

    assert!(
        search(&pool, "responder@example.com", "acme", 10)
            .await
            .rows
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn trashing_the_database_hides_its_rows(pool: PgPool) {
    sqlx::query!(
        "UPDATE database_entities SET trashed_at = now() WHERE database_id = $1",
        ACCOUNTS
    )
    .execute(&pool)
    .await
    .expect("trash");

    assert!(
        search(&pool, "owner@example.com", "acme", 10)
            .await
            .rows
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn a_deleted_row_is_not_shown(pool: PgPool) {
    sqlx::query!("DELETE FROM database_rows WHERE id = $1", ACME_ROW)
        .execute(&pool)
        .await
        .expect("delete row");

    assert!(
        search(&pool, "owner@example.com", "acme", 10)
            .await
            .rows
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn an_edited_cell_shows_its_new_text_and_never_the_old(pool: PgPool) {
    // The index still says "Renewal with Acme due in May".
    sqlx::query!(
        r#"UPDATE entity_properties SET values = '{"type": "String", "value": "Renewal moved to June"}'
           WHERE id = '70000000-0000-7000-8000-000000000002'"#,
    )
    .execute(&pool)
    .await
    .expect("edit notes");

    let page = search(&pool, "owner@example.com", "acme", 10).await;
    assert_eq!(shown(&page), vec![ACME_ROW]);
    // Found by its title alone now: no snippet, and never the old notes.
    assert_eq!(page.rows[0].item.snippet, None);

    let renewal_may = search(&pool, "owner@example.com", "renewal may", 10).await;
    assert!(renewal_may.rows.is_empty());

    sqlx::query!(
        r#"UPDATE entity_properties SET values = '{"type": "String", "value": "Initech"}'
           WHERE id = '70000000-0000-7000-8000-000000000001'"#,
    )
    .execute(&pool)
    .await
    .expect("rename");

    assert!(
        search(&pool, "owner@example.com", "acme", 10)
            .await
            .rows
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn the_next_page_comes_only_from_a_row_the_caller_may_see(pool: PgPool) {
    // Two rows match for the owner; the trashed, CRM and deleted proposals
    // after them must not promise a next page.
    sqlx::query!(
        r#"UPDATE entity_properties SET values = '{"type": "String", "value": "Globex, formerly Acme"}'
           WHERE id = '70000000-0000-7000-8000-000000000003'"#,
    )
    .execute(&pool)
    .await
    .expect("rename globex");

    let first = search(&pool, "owner@example.com", "acme", 1).await;
    assert_eq!(shown(&first), vec![ACME_ROW]);
    // The cursor names the last row shown, and nothing else.
    assert_eq!(first.next.map(|next| next.row_id), Some(ACME_ROW));

    let second = search_after(&pool, "owner@example.com", "acme", 1, first.next).await;
    assert_eq!(shown(&second), vec![GLOBEX_ROW]);
    assert_eq!(second.next, None);

    // The viewer may see nothing past the first row either.
    sqlx::query!("DELETE FROM database_rows WHERE id = $1", GLOBEX_ROW)
        .execute(&pool)
        .await
        .expect("delete globex");
    let viewer = search(&pool, "viewer@example.com", "acme", 1).await;
    assert_eq!(shown(&viewer), vec![ACME_ROW]);
    assert_eq!(viewer.next, None);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn crm_storage_rows_are_never_shown_even_with_a_grant(pool: PgPool) {
    // The viewer holds a grant on the CRM storage database, which has no
    // database entity.
    let source = source(&pool, every_acme_proposal());
    let user_id = "macro|viewer@example.com".to_string();
    let user = MacroUserId::parse_from_str(&user_id)
        .expect("user id")
        .lowercase();
    let viewer = source.viewer(&user).await.expect("viewer");

    assert!(
        !source
            .viewable_database_ids(&viewer)
            .await
            .expect("databases")
            .contains(&CRM_STORAGE)
    );
    assert!(
        source
            .viewable_rows(&viewer, &[CRM_ROW])
            .await
            .expect("rows")
            .is_empty()
    );
    assert!(
        source
            .current_rows(&[CRM_ROW])
            .await
            .expect("current")
            .is_empty()
    );
    let page = search(&pool, "viewer@example.com", "acme", 10).await;
    assert!(!shown(&page).contains(&CRM_ROW));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("database_rows"))
)]
async fn the_most_recent_databases_are_live_ones_newest_first(pool: PgPool) {
    let source = source(&pool, Vec::new());

    let newest = source
        .most_recent_databases(&[ARCHIVE, CRM_STORAGE, ACCOUNTS], 10)
        .await
        .expect("databases");

    // The archive is in the Trash and CRM storage has no database entity.
    assert_eq!(newest, vec![ACCOUNTS]);
}
