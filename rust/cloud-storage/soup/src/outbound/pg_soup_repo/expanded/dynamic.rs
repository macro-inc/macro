//! This module exposes a expanded dynamic query builder which is able to build specific soup queries
//! which filter out content basd on some input ast

use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{Query, SimpleSortMethod};
use models_soup::item::SoupItem;
use sqlx::PgPool;

#[tracing::instrument(skip(db, limit))]
pub async fn expanded_dynamic_cursor_soup(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
    limit: u16,
    cursor: Query<String, SimpleSortMethod, EntityFilterAst>,
) -> Result<Vec<SoupItem>, sqlx::Error> {
    let query_limit = limit as i64;
    let sort_method_str = cursor.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = cursor.vals();
    todo!()
}
