//! Select sparse provider folder membership before resolving effective mailbox facts.

use crate::domain::models::{PreviewView, PreviewViewStandardLabel};
use sqlx::{Postgres, QueryBuilder};

pub(super) fn is_folder(view: &PreviewView) -> bool {
    matches!(
        view,
        PreviewView::StandardLabel(
            PreviewViewStandardLabel::Spam | PreviewViewStandardLabel::Trash
        )
    )
}

/// Raw provider state and pending positive intent form a superset. The canonical
/// facts view removes pending restores, provider-missing messages, and junk that
/// is also in Trash. No denormalized folder timestamp can go stale during rollout.
pub(super) fn push_folder_threads(
    builder: &mut QueryBuilder<'static, Postgres>,
    view: &PreviewView,
    mut push_scope: impl FnMut(&mut QueryBuilder<'static, Postgres>),
) {
    let (label, attribute, predicate) = match view {
        PreviewView::StandardLabel(PreviewViewStandardLabel::Spam) => {
            ("SPAM", "in_junk", "mf.in_junk AND NOT mf.in_trash")
        }
        PreviewView::StandardLabel(PreviewViewStandardLabel::Trash) => {
            ("TRASH", "in_trash", "mf.in_trash")
        }
        _ => unreachable!("folder candidate selection requires a folder view"),
    };
    builder
        .push(" FROM (SELECT fm.thread_id, MAX(fm.message_ts) AS latest_folder_message_ts FROM (");
    // All interpolated identifiers/JSON literals come from the closed view match.
    // Keep the JSON containment predicate literal so PostgreSQL can use its partial
    // index even in a prepared query. User-controlled scopes remain bind parameters.
    for source in 0..3 {
        if source > 0 {
            builder.push(" UNION ");
        }
        builder.push(
            "SELECT m.id, m.thread_id, COALESCE(m.internal_date_ts, m.created_at) AS message_ts ",
        );
        match source {
            0 => {
                builder.push(
                    r#"FROM email_labels l
                    JOIN email_message_labels ml ON ml.label_id = l.id
                    JOIN email_messages m ON m.id = ml.message_id
                    JOIN email_threads t ON t.id = m.thread_id AND t.link_id = m.link_id
                    WHERE l.link_id = t.link_id AND l.provider_label_id = "#,
                );
                builder.push_bind(label);
            }
            1 => {
                builder.push(format!(
                    r#"FROM email_messages m
                    JOIN email_threads t ON t.id = m.thread_id AND t.link_id = m.link_id
                    WHERE m.mailbox_state @> '{{"{attribute}":true}}'::jsonb"#,
                ));
            }
            _ => {
                builder.push(
                    r#"FROM email_pending_mailbox_state p
                    JOIN email_messages m ON m.id = p.message_id
                    JOIN email_threads t ON t.id = m.thread_id AND t.link_id = m.link_id
                    WHERE p.desired = 'true'::jsonb AND p.attribute = "#,
                );
                builder.push_bind(attribute);
            }
        }
        builder.push(" AND ");
        push_scope(builder);
    }
    builder.push(format!(
        r#") fm
        JOIN email_message_mailbox_facts mf ON mf.id = fm.id
        WHERE mf.is_present AND {predicate}
        GROUP BY fm.thread_id) folder
        JOIN email_threads t ON t.id = folder.thread_id "#,
    ));
}
