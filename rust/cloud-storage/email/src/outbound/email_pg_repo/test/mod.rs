mod crm_scope_dynamic_query;
mod draft;
mod dynamic_query;
mod importance_pagination;
mod labels;
mod link;
mod message;
mod preview;
mod project_scope_dynamic_query;
mod signal_flag;
mod thread;
mod thread_labels;

use std::sync::Arc;

use super::*;
use crate::domain::models::{LabelType, PreviewView, PreviewViewStandardLabel};
use crate::domain::ports::EmailRepo;
use chrono::{TimeZone, Utc};
use filter_ast::Expr;
use item_filters::ast::date::DateLiteral;
use item_filters::ast::email::{Email, EmailLiteral};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::email::EmailStr;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Cursor, CursorVal, Query, SimpleSortMethod};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

/// Recomputes `is_signal` for every fixture thread via the real sync
/// function, so importance tests exercise the heuristic → flag → query chain
/// end-to-end instead of trusting hand-written fixture verdicts.
async fn sync_all_signal_flags(pool: &Pool<Postgres>) -> anyhow::Result<()> {
    let thread_ids: Vec<Uuid> = sqlx::query_scalar("SELECT id FROM email_threads")
        .fetch_all(pool)
        .await?;
    let mut conn = pool.acquire().await?;
    for id in thread_ids {
        super::thread::sync_thread_signal_flag(&mut conn, id).await?;
    }
    Ok(())
}
