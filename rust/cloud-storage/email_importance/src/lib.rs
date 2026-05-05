#![deny(missing_docs)]
//! Sender-importance SQL logic shared between the `email` and `email_service` crates.
//!
//! Business rules: email-level overrides take precedence over domain-level; a domain-level
//! match is suppressed by an email-level override of the opposite importance.

#[cfg(test)]
mod test;

use anyhow::Result;
use sqlx::types::Uuid;
use sqlx::{PgPool, Postgres, QueryBuilder};

/// Pushes a correlated SQL subquery into `builder` that matches senders where `email_filters`
/// has an override with the given `is_important` value for the message's `link_id`.
///
/// Email-level matches take precedence; domain-level matches are suppressed when an
/// email-level override of the opposite importance exists for the same address.
/// All table aliases (`m`, `sender_c`, `ef`, `ef_addr`) must be defined in the outer query.
pub fn build_sender_importance_override_filter(
    is_important: bool,
    builder: &mut QueryBuilder<'_, Postgres>,
) {
    let tf = if is_important { "TRUE" } else { "FALSE" };
    let opp = if is_important { "FALSE" } else { "TRUE" };
    builder.push(
        r#"(
                    EXISTS (
                        SELECT 1
                        FROM email_contacts sender_c
                        JOIN email_filters ef
                          ON ef.link_id = m.link_id
                         AND ef.email_address IS NOT NULL
                         AND LOWER(ef.email_address) = LOWER(sender_c.email_address)
                        WHERE sender_c.id = m.from_contact_id
                          AND ef.is_important = "#,
    );
    builder.push(tf);
    builder.push(
        r#"
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM email_contacts sender_c
                        JOIN email_filters ef
                          ON ef.link_id = m.link_id
                         AND ef.email_domain IS NOT NULL
                         AND LOWER(ef.email_domain) = LOWER(split_part(sender_c.email_address, '@', 2))
                        WHERE sender_c.id = m.from_contact_id
                          AND ef.is_important = "#,
    );
    builder.push(tf);
    builder.push(
        r#"
                          AND NOT EXISTS (
                              SELECT 1
                              FROM email_filters ef_addr
                              WHERE ef_addr.link_id = m.link_id
                                AND ef_addr.email_address IS NOT NULL
                                AND LOWER(ef_addr.email_address) = LOWER(sender_c.email_address)
                                AND ef_addr.is_important = "#,
    );
    builder.push(opp);
    builder.push(
        r#"
                          )
                    )
                )"#,
    );
}

/// Pushes the inner SQL condition for an importance filter into `builder`.
///
/// When `is_important = true`: sender explicitly marked important, or no noise override and
/// the message is not deprioritised by labels.
///
/// When `is_important = false`: sender explicitly marked as noise, or no importance override
/// and the message carries noise-category labels but not personal/sent/draft labels.
///
/// All table aliases (`m`, `sender_c`, `ef`, `ef_addr`) must be in scope in the outer query.
pub fn build_importance_condition(is_important: bool, builder: &mut QueryBuilder<'_, Postgres>) {
    builder.push("(");
    build_sender_importance_override_filter(is_important, builder);
    if is_important {
        builder.push(
            r#" OR (
        NOT "#,
        );
        build_sender_importance_override_filter(false, builder);
        builder.push(
            r#"
        AND (
            m.is_draft = TRUE
            OR EXISTS (
                SELECT 1 FROM email_message_labels ml
                JOIN email_labels l ON ml.label_id = l.id
                WHERE ml.message_id = m.id
                AND l.name IN ('CATEGORY_PERSONAL', 'SENT', 'DRAFT')
            )
            OR NOT EXISTS (
                SELECT 1 FROM email_message_labels ml
                JOIN email_labels l ON ml.label_id = l.id
                WHERE ml.message_id = m.id
                AND l.name IN ('CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS')
            )
        )
    ))"#,
        );
    } else {
        builder.push(
            r#"
                OR (
                    NOT "#,
        );
        build_sender_importance_override_filter(true, builder);
        builder.push(
            r#"
                    AND NOT EXISTS (
                        SELECT 1 FROM email_message_labels ml
                        JOIN email_labels l ON ml.label_id = l.id
                        WHERE ml.message_id = m.id
                        AND l.name IN ('CATEGORY_PERSONAL', 'SENT', 'DRAFT')
                    )
                    AND EXISTS (
                        SELECT 1 FROM email_message_labels ml
                        JOIN email_labels l ON ml.label_id = l.id
                        WHERE ml.message_id = m.id
                        AND l.name IN ('CATEGORY_UPDATES', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS')
                    )
                )
            )"#,
        );
    }
}

/// Returns `true` if the message would match the `Importance(true)` filter: the sender is
/// explicitly marked important, or the sender has no noise override and the message is not
/// deprioritised by labels.
///
/// SPAM and TRASH messages are always excluded, regardless of sender overrides.
///
/// Uses [`build_importance_condition`] to mirror the `EmailLiteral::Importance(true)`
/// match arm exactly.
#[tracing::instrument(err, skip(db))]
pub async fn is_message_important(db: &PgPool, message_id: Uuid) -> Result<bool> {
    let mut builder: QueryBuilder<'_, Postgres> =
        QueryBuilder::new("SELECT EXISTS(SELECT 1 FROM email_messages m WHERE m.id = ");
    builder.push_bind(message_id);
    builder.push(
        " AND NOT EXISTS (SELECT 1 FROM email_message_labels ml JOIN email_labels l ON ml.label_id = l.id WHERE ml.message_id = m.id AND l.name IN ('SPAM', 'TRASH')) AND ",
    );
    build_importance_condition(true, &mut builder);
    builder.push(")");
    let result: bool = builder.build_query_scalar().fetch_one(db).await?;
    Ok(result)
}
