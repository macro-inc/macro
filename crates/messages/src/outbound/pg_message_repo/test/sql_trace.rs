use super::*;
use sqlx::ConnectOptions;
use std::{
    fmt,
    future::Future,
    sync::{Arc, Mutex},
    time::Instant,
};
use tracing::{
    Event, Metadata, Subscriber,
    field::{Field, Visit},
    instrument::WithSubscriber,
    span::{Attributes, Id, Record},
};

#[derive(Clone, Default)]
struct Statements(Arc<Mutex<Vec<CapturedQuery>>>);

pub(super) struct CapturedQuery {
    pub(super) sql: String,
    pub(super) elapsed_seconds: f64,
    pub(super) finished_at: Instant,
}

#[derive(Default)]
struct Statement {
    summary: String,
    sql: String,
    elapsed_seconds: f64,
}

impl Visit for Statement {
    fn record_f64(&mut self, field: &Field, value: f64) {
        if field.name() == "elapsed_secs" {
            self.elapsed_seconds = value;
        }
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        match field.name() {
            "summary" => self.summary = format!("{value:?}"),
            "db.statement" => self.sql = format!("{value:?}"),
            _ => {}
        }
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        match field.name() {
            "summary" => self.summary = value.to_owned(),
            "db.statement" => self.sql = value.to_owned(),
            _ => {}
        }
    }
}

impl Subscriber for Statements {
    fn enabled(&self, metadata: &Metadata<'_>) -> bool {
        metadata.target() == "sqlx::query"
    }

    fn new_span(&self, _span: &Attributes<'_>) -> Id {
        Id::from_u64(1)
    }

    fn record(&self, _span: &Id, _values: &Record<'_>) {}
    fn record_follows_from(&self, _span: &Id, _follows: &Id) {}
    fn enter(&self, _span: &Id) {}
    fn exit(&self, _span: &Id) {}

    fn event(&self, event: &Event<'_>) {
        let mut statement = Statement::default();
        event.record(&mut statement);
        let sql = if statement.sql.is_empty() {
            statement.summary
        } else {
            statement.sql
        };
        self.0.lock().unwrap().push(CapturedQuery {
            sql,
            elapsed_seconds: statement.elapsed_seconds,
            finished_at: Instant::now(),
        });
    }
}

pub(super) async fn capture_queries<F: Future>(future: F) -> (F::Output, Vec<CapturedQuery>) {
    let statements = Statements::default();
    let result = future.with_subscriber(statements.clone()).await;
    let captured = std::mem::take(&mut *statements.0.lock().unwrap());
    (result, captured)
}

async fn capture<F: Future>(future: F) -> (F::Output, Vec<String>) {
    let (result, queries) = capture_queries(future).await;
    (result, queries.into_iter().map(|query| query.sql).collect())
}

fn unchanged(operation: &str, before: Vec<String>, after: Vec<String>) {
    assert!(!before.is_empty(), "SQL tracing must record statements");
    assert_eq!(before, after, "document {operation} SQL changed");
    eprintln!(
        "document {operation}: {} statements before and after",
        before.len()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn document_writes_execute_exactly_the_previous_statements(pool: PgPool) {
    setup(&pool).await;
    let traced_pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect_with(
            pool.connect_options()
                .as_ref()
                .clone()
                .log_statements("trace".parse().unwrap()),
        )
        .await
        .unwrap();
    let repo = PgMessageRepository::new(traced_pool);
    let (old, before) =
        capture(repo.create_before_sequences(command("message-doc-a", None, "before"))).await;
    let (new, after) = capture(repo.create(command("message-doc-a", None, "before"))).await;
    unchanged("create", before, after);
    let old = old.unwrap();
    let (new, seq) = new.unwrap();
    assert_eq!(seq, None);

    let edit = EditMessage {
        notification_policy: Default::default(),
        content: "after".into(),
        mentions: vec![],
        attachments: None,
        nonce: None,
    };
    let (result, before) =
        capture(repo.edit_before_sequences(&old.parent, old.id, edit.clone())).await;
    result.unwrap();
    let (result, after) = capture(repo.edit(&new.parent, new.id, edit)).await;
    assert_eq!(result.unwrap().1, None);
    unchanged("edit", before, after);

    let (result, before) =
        capture(repo.react_before_sequences(&old.parent, old.id, USER, "👍", true)).await;
    result.unwrap();
    let (result, after) = capture(repo.react(&new.parent, new.id, USER, "👍", true)).await;
    assert_eq!(result.unwrap().seq, None);
    unchanged("react", before, after);

    let patch = ThreadPatch {
        resolved: Some(true),
        ..Default::default()
    };
    let (result, before) =
        capture(repo.set_thread_before_sequences(&old.parent, old.id, patch.clone(), false)).await;
    result.unwrap();
    let (result, after) = capture(repo.patch_thread(&new.parent, new.id, patch)).await;
    assert_eq!(result.unwrap().1, None);
    unchanged("patch_thread", before, after);

    let (result, before) = capture(repo.delete_before_sequences(&old.parent, old.id)).await;
    result.unwrap();
    let (result, after) = capture(repo.delete(&new.parent, new.id)).await;
    assert_eq!(result.unwrap().1, None);
    unchanged("delete", before, after);

    let (result, before) = capture(repo.set_thread_before_sequences(
        &old.parent,
        old.id,
        ThreadPatch::default(),
        true,
    ))
    .await;
    result.unwrap();
    let (result, after) = capture(repo.delete_thread(&new.parent, new.id)).await;
    assert_eq!(result.unwrap().1, None);
    unchanged("delete_thread", before, after);

    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM channel_change_log")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
    assert_eq!(
        sqlx::query_scalar!("SELECT count(*) FROM channel_change_counters")
            .fetch_one(&pool)
            .await
            .unwrap(),
        Some(0)
    );
}
