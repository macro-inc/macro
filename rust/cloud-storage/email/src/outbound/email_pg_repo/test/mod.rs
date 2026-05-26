mod crm_scope_dynamic_query;
mod draft;
mod dynamic_query;
mod labels;
mod link;
mod message;
mod preview;
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
