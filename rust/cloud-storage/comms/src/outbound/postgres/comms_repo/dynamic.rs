//! This module exposes a dynamic query builder for channel queries
//! which can filter channels based on an input AST

use crate::domain::models::GetChannelsParams;
use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::ast::{LiteralTree, channel::ChannelLiteral};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_comms::channel::{
    Channel, ChannelId, ChannelParticipant, ChannelWithParticipants, OrganizationId,
};
use recursion::CollapsibleExt;
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder, Row, postgres::PgRow};
use uuid::Uuid;

#[cfg(test)]
mod tests;

static PREFIX: &str = r#"
    WITH user_channels AS (
        SELECT DISTINCT c.*
        FROM comms_channels c
        INNER JOIN comms_channel_participants cp ON cp.channel_id = c.id
        WHERE cp.user_id = $1 AND cp.left_at IS NULL
"#;

static CHANNEL_SELECT: &str = r#"
    ),
    channel_participants_json AS (
        SELECT
            uc.id as channel_id,
            ARRAY_AGG(
                json_build_object(
                    'channel_id', cp.channel_id,
                    'user_id', cp.user_id,
                    'role', cp.role,
                    'joined_at', cp.joined_at,
                    'left_at', cp.left_at
                )
            ) as participants
        FROM user_channels uc
        JOIN comms_channel_participants cp ON cp.channel_id = uc.id
        WHERE cp.left_at IS NULL
        GROUP BY uc.id
    )
    SELECT
        uc.id as "id",
        uc.name as "name",
        uc.channel_type as "channel_type",
        uc.org_id as "org_id",
        uc.team_id as "team_id",
        uc.created_at as "created_at",
        uc.updated_at as "updated_at",
        uc.owner_id as "owner_id",
        cpj.participants as "participants_json"
    FROM user_channels uc
    LEFT JOIN channel_participants_json cpj ON cpj.channel_id = uc.id
    WHERE
        ($4::timestamptz IS NULL)
        OR
        ((CASE $2 WHEN 'created_at' THEN uc.created_at ELSE uc.updated_at END), uc.id::text) < ($4, $5)
    ORDER BY (CASE $2 WHEN 'created_at' THEN uc.created_at ELSE uc.updated_at END) DESC, uc.updated_at DESC
    LIMIT $3
"#;

fn build_notification_exists_clause(
    entity_id_sql: &str,
    entity_type: &str,
    predicate_sql: &str,
) -> String {
    format!(
        r#"EXISTS (
            SELECT 1
            FROM notification n
            JOIN user_notification un ON un.notification_id = n.id
            WHERE un.user_id = $1
              AND un.deleted_at IS NULL
              AND n.event_item_type = '{entity_type}'
              AND n.event_item_id = ({entity_id_sql})::text
              AND {predicate_sql}
        )"#
    )
}

fn build_notification_done_clause(entity_id_sql: &str, entity_type: &str, done: bool) -> String {
    build_notification_exists_clause(
        entity_id_sql,
        entity_type,
        if done {
            "un.done = true"
        } else {
            "un.done = false"
        },
    )
}

fn build_notification_seen_clause(entity_id_sql: &str, entity_type: &str, seen: bool) -> String {
    build_notification_exists_clause(
        entity_id_sql,
        entity_type,
        if seen {
            "un.seen_at IS NOT NULL"
        } else {
            "un.seen_at IS NULL"
        },
    )
}

fn build_channel_filter(ast: Option<&Expr<ChannelLiteral>>) -> String {
    let Some(expr) = ast else {
        return String::new();
    };
    let formatting = expr.collapse_frames(|frame: filter_ast::ExprFrame<String, _>| match frame {
        filter_ast::ExprFrame::And(a, b) => match (a.is_empty(), b.is_empty()) {
            (true, true) => String::new(),
            (true, false) => b,
            (false, true) => a,
            (false, false) => format!("({a} AND {b})"),
        },
        filter_ast::ExprFrame::Or(a, b) => match (a.is_empty(), b.is_empty()) {
            (true, true) => String::new(),
            (true, false) => b,
            (false, true) => a,
            (false, false) => format!("({a} OR {b})"),
        },
        filter_ast::ExprFrame::Not(a) => {
            if a.is_empty() {
                String::new()
            } else {
                format!("(NOT {a})")
            }
        }
        filter_ast::ExprFrame::Literal(ChannelLiteral::ChannelId(id)) => {
            format!("c.id = '{id}'")
        }
        filter_ast::ExprFrame::Literal(ChannelLiteral::OrganizationId(org_id)) => {
            format!("c.org_id = {org_id}")
        }
        filter_ast::ExprFrame::Literal(ChannelLiteral::TeamId(team_id)) => {
            format!("c.team_id = '{team_id}'")
        }
        filter_ast::ExprFrame::Literal(ChannelLiteral::ChannelType(ct)) => {
            format!("c.channel_type = '{ct}'")
        }
        // These filters don't apply at the channel level, they're for messages
        // So we return an empty string which will be filtered out
        filter_ast::ExprFrame::Literal(ChannelLiteral::ThreadId(_)) => String::new(),
        filter_ast::ExprFrame::Literal(ChannelLiteral::Mention(_)) => String::new(),
        filter_ast::ExprFrame::Literal(ChannelLiteral::Sender(_)) => String::new(),
        filter_ast::ExprFrame::Literal(ChannelLiteral::Importance(true)) => String::new(),
        // all channels are important, so if importance is false, exclude them
        filter_ast::ExprFrame::Literal(ChannelLiteral::Importance(false)) => "1=0".to_string(),
        filter_ast::ExprFrame::Literal(ChannelLiteral::NotificationDone(done)) => {
            build_notification_done_clause("c.id", "channel", done)
        }
        filter_ast::ExprFrame::Literal(ChannelLiteral::NotificationSeen(seen)) => {
            build_notification_seen_clause("c.id", "channel", seen)
        }
    });
    if formatting.is_empty() {
        String::new()
    } else {
        format!(" AND {}", formatting)
    }
}

fn build_query(filter_ast: &LiteralTree<ChannelLiteral>) -> QueryBuilder<'_, Postgres> {
    let mut builder = sqlx::QueryBuilder::new(PREFIX);

    // Add channel filter if present
    builder.push(build_channel_filter(filter_ast.as_deref()));

    builder.push(CHANNEL_SELECT);

    builder
}

#[derive(Debug, FromRow)]
struct ChannelRow {
    id: Uuid,
    name: Option<String>,
    channel_type: super::ChannelType,
    org_id: Option<i64>,
    team_id: Option<uuid::Uuid>,
    created_at: DateTime<Utc>,
    updated_at: DateTime<Utc>,
    owner_id: String,
    participants_json: Option<Vec<serde_json::Value>>,
}

impl ChannelRow {
    fn into_channel_with_participants(self) -> Result<ChannelWithParticipants, sqlx::Error> {
        use doppleganger::Mirror;

        let channel = Channel {
            id: ChannelId(self.id),
            name: self.name,
            channel_type: super::ChannelType::mirror(self.channel_type),
            org_id: self.org_id.map(|id| OrganizationId(id as u32)),
            team_id: self.team_id,
            created_at: self.created_at,
            updated_at: self.updated_at,
            owner_id: MacroUserIdStr::parse_from_str(&self.owner_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
        };

        let participants = self
            .participants_json
            .map(|json_array| {
                json_array
                    .iter()
                    .filter_map(|json_value| {
                        serde_json::from_value::<ChannelParticipant>(json_value.clone()).ok()
                    })
                    .collect::<Vec<ChannelParticipant>>()
            })
            .unwrap_or_default();

        Ok(ChannelWithParticipants {
            channel,
            participants,
        })
    }
}

#[tracing::instrument(skip(db), err(Debug))]
pub async fn get_user_channels_dynamic(
    db: &PgPool,
    params: &GetChannelsParams,
) -> Result<Vec<ChannelWithParticipants>, sqlx::Error> {
    let user_id = params.user();
    let query_limit = params.limit().map(|l| l as i64);
    let cursor = params.query();
    let sort_method_str = cursor.sort_method().to_string();
    let (cursor_id, cursor_timestamp) = cursor.vals();
    let cursor_id_str = cursor_id.as_ref().map(|u| u.to_string());

    build_query(cursor.filter())
        .build()
        .bind(user_id.as_ref())
        .bind(sort_method_str)
        .bind(query_limit)
        .bind(cursor_timestamp)
        .bind(cursor_id_str)
        .try_map(|row: PgRow| {
            let channel_row = ChannelRow {
                id: row.try_get("id")?,
                name: row.try_get("name")?,
                channel_type: row.try_get("channel_type")?,
                org_id: row.try_get("org_id")?,
                team_id: row.try_get("team_id")?,
                created_at: row.try_get("created_at")?,
                updated_at: row.try_get("updated_at")?,
                owner_id: row.try_get("owner_id")?,
                participants_json: row.try_get("participants_json")?,
            };
            channel_row.into_channel_with_participants()
        })
        .fetch_all(db)
        .await
}
