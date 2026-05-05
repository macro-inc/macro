#![deny(missing_docs)]
//! Sender-importance SQL logic shared between the `email` and `email_service` crates.
//!
//! Provides parameterized SQL fragment builders used by both the dynamic query builder in
//! `email` and the message-processing pipeline in `email_service`. Business rules:
//! email-level overrides take precedence over domain-level; a domain-level match is suppressed
//! by an email-level override of the opposite importance.

#[cfg(test)]
mod test;

use anyhow::Result;
use sqlx::types::Uuid;
use sqlx::{PgPool, Postgres, QueryBuilder};

// ---------------------------------------------------------------------------
// SqlFragment: parameterized SQL builder that separates raw SQL from bind values
// ---------------------------------------------------------------------------

pub(crate) enum SqlSegment {
    Raw(String),
    BindString(String),
    BindUuid(Uuid),
}

/// Parameterized SQL builder that separates raw SQL text from bind values.
pub struct SqlFragment {
    segments: Vec<SqlSegment>,
}

impl SqlFragment {
    /// Creates an empty fragment.
    pub fn empty() -> Self {
        Self { segments: vec![] }
    }

    /// Creates a fragment from a raw SQL string.
    pub fn raw(s: impl Into<String>) -> Self {
        Self {
            segments: vec![SqlSegment::Raw(s.into())],
        }
    }

    /// Creates a fragment containing a single string bind parameter.
    pub fn bind_string(s: impl Into<String>) -> Self {
        Self {
            segments: vec![SqlSegment::BindString(s.into())],
        }
    }

    /// Creates a fragment containing a single UUID bind parameter.
    pub fn bind_uuid(u: Uuid) -> Self {
        Self {
            segments: vec![SqlSegment::BindUuid(u)],
        }
    }

    /// Returns `true` if the fragment contains no segments.
    pub fn is_empty(&self) -> bool {
        self.segments.is_empty()
    }

    /// Appends a raw SQL string to the fragment.
    pub fn push_raw(&mut self, s: impl Into<String>) {
        self.segments.push(SqlSegment::Raw(s.into()));
    }

    /// Appends all segments from `other` into this fragment.
    pub fn extend(&mut self, other: Self) {
        self.segments.extend(other.segments);
    }

    /// Combines two fragments with `AND`.
    pub fn and(a: Self, b: Self) -> Self {
        let mut f = Self::raw("(");
        f.extend(a);
        f.push_raw(" AND ");
        f.extend(b);
        f.push_raw(")");
        f
    }

    /// Combines two fragments with `OR`.
    pub fn or(a: Self, b: Self) -> Self {
        let mut f = Self::raw("(");
        f.extend(a);
        f.push_raw(" OR ");
        f.extend(b);
        f.push_raw(")");
        f
    }

    /// Wraps a fragment in `NOT (...)`.
    pub fn not(a: Self) -> Self {
        let mut f = Self::raw("(NOT ");
        f.extend(a);
        f.push_raw(")");
        f
    }

    /// Prepends ` AND ` to the fragment if non-empty.
    pub fn with_and_prefix(self) -> Self {
        if self.is_empty() {
            return self;
        }
        let mut f = Self::raw(" AND ");
        f.extend(self);
        f
    }

    /// Pushes all segments into a [`QueryBuilder`].
    pub fn push_into(self, builder: &mut QueryBuilder<'_, Postgres>) {
        for segment in self.segments {
            match segment {
                SqlSegment::Raw(s) => {
                    builder.push(s);
                }
                SqlSegment::BindString(s) => {
                    builder.push_bind(s);
                }
                SqlSegment::BindUuid(u) => {
                    builder.push_bind(u);
                }
            }
        }
    }
}

#[cfg(any(test, feature = "testing"))]
impl SqlFragment {
    /// Renders the fragment as a debug SQL string with bind values shown inline.
    pub fn to_debug_sql(&self) -> String {
        let mut result = String::new();
        let mut bind_idx = 0;
        for segment in &self.segments {
            match segment {
                SqlSegment::Raw(s) => result.push_str(s),
                SqlSegment::BindString(s) => {
                    bind_idx += 1;
                    result.push_str(&format!("${bind_idx}[str={s}]"));
                }
                SqlSegment::BindUuid(u) => {
                    bind_idx += 1;
                    result.push_str(&format!("${bind_idx}[uuid={u}]"));
                }
            }
        }
        result
    }

    /// Returns `true` if any bind parameter is a string equal to `expected`.
    pub fn has_bind_string(&self, expected: &str) -> bool {
        self.segments
            .iter()
            .any(|s| matches!(s, SqlSegment::BindString(v) if v == expected))
    }

    /// Returns `true` if any bind parameter is a UUID equal to `expected`.
    pub fn has_bind_uuid(&self, expected: &Uuid) -> bool {
        self.segments
            .iter()
            .any(|s| matches!(s, SqlSegment::BindUuid(v) if v == expected))
    }

    /// Returns `true` if no raw SQL segment contains `needle`.
    pub fn has_no_raw_containing(&self, needle: &str) -> bool {
        !self
            .segments
            .iter()
            .any(|s| matches!(s, SqlSegment::Raw(v) if v.contains(needle)))
    }
}

/// Builds a correlated SQL subquery fragment that matches senders where `email_filters`
/// has an override with the given `is_important` value for the message's `link_id`.
///
/// Email-level matches take precedence; domain-level matches are suppressed when an
/// email-level override of the opposite importance exists for the same address.
/// All table aliases (`m`, `sender_c`, `ef`, `ef_addr`) must be defined in the outer query.
pub fn build_sender_importance_override_filter(is_important: bool) -> SqlFragment {
    let importance_literal = if is_important { "TRUE" } else { "FALSE" };
    let opposite_importance_literal = if is_important { "FALSE" } else { "TRUE" };

    SqlFragment::raw(format!(
        r#"(
                    EXISTS (
                        SELECT 1
                        FROM email_contacts sender_c
                        JOIN email_filters ef
                          ON ef.link_id = m.link_id
                         AND ef.email_address IS NOT NULL
                         AND LOWER(ef.email_address) = LOWER(sender_c.email_address)
                        WHERE sender_c.id = m.from_contact_id
                          AND ef.is_important = {importance_literal}
                    )
                    OR EXISTS (
                        SELECT 1
                        FROM email_contacts sender_c
                        JOIN email_filters ef
                          ON ef.link_id = m.link_id
                         AND ef.email_domain IS NOT NULL
                         AND LOWER(ef.email_domain) = LOWER(split_part(sender_c.email_address, '@', 2))
                        WHERE sender_c.id = m.from_contact_id
                          AND ef.is_important = {importance_literal}
                          AND NOT EXISTS (
                              SELECT 1
                              FROM email_filters ef_addr
                              WHERE ef_addr.link_id = m.link_id
                                AND ef_addr.email_address IS NOT NULL
                                AND LOWER(ef_addr.email_address) = LOWER(sender_c.email_address)
                                AND ef_addr.is_important = {opposite_importance_literal}
                          )
                    )
                )"#,
    ))
}

/// Builds the inner SQL condition for an importance filter.
///
/// When `is_important = true`: sender explicitly marked important, or no noise override and
/// the message is not deprioritised by labels.
///
/// When `is_important = false`: sender explicitly marked as noise, or no importance override
/// and the message carries noise-category labels but not personal/sent/draft labels.
///
/// All table aliases (`m`, `sender_c`, `ef`, `ef_addr`) must be in scope in the outer query.
pub fn build_importance_condition(is_important: bool) -> SqlFragment {
    let mut f = SqlFragment::raw("(");
    f.extend(build_sender_importance_override_filter(is_important));
    f.push_raw(r#" OR ( NOT "#);
    f.extend(build_sender_importance_override_filter(!is_important));
    if is_important {
        f.push_raw(
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
        f.push_raw(
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

    f
}

/// Returns `true` if the message would match the `Importance(true)` filter: the sender is
/// explicitly marked important, or the sender has no noise override and the message is not
/// deprioritised by labels.
///
/// Uses [`build_importance_condition`] to mirror the `EmailLiteral::Importance(true)`
/// match arm exactly.
pub async fn is_message_important(db: &PgPool, message_id: Uuid) -> Result<bool> {
    let mut builder =
        QueryBuilder::new("SELECT EXISTS(SELECT 1 FROM email_messages m WHERE m.id = ");
    builder.push_bind(message_id);
    builder.push(" AND ");
    build_importance_condition(true).push_into(&mut builder);
    builder.push(")");
    let result: bool = builder.build_query_scalar().fetch_one(db).await?;
    Ok(result)
}
