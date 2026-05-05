#![deny(missing_docs)]
//! Sender-importance override SQL logic shared between the `email` and `email_service` crates.
//!
//! The `email` crate uses [`build_sender_importance_override_filter`] to embed the logic as a
//! correlated SQL subquery fragment. `email_service` uses [`get_sender_importance_override`] to
//! run a standalone query at message-processing time. Both encode the same business rules:
//! email-level overrides take precedence over domain-level; a domain-level match is suppressed
//! by an email-level override of the opposite importance.

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

/// Returns the sender's importance override: `Some(true)` = signal, `Some(false)` = noise,
/// `None` = no override configured.
///
/// Email-level matches take precedence over domain-level; a domain-level match is suppressed
/// by an email-level override of the opposite importance for the same address.
/// Mirrors the SQL produced by [`build_sender_importance_override_filter`].
#[tracing::instrument(err, skip(db))]
pub async fn get_sender_importance_override(
    db: &PgPool,
    from_contact_id: Uuid,
    link_id: Uuid,
) -> Result<Option<bool>> {
    let email_level = sqlx::query!(
        r#"
        SELECT ef.is_important
        FROM email_contacts c
        JOIN email_filters ef
          ON ef.link_id = $2
         AND ef.email_address IS NOT NULL
         AND LOWER(ef.email_address) = LOWER(c.email_address)
        WHERE c.id = $1
        LIMIT 1
        "#,
        from_contact_id,
        link_id,
    )
    .fetch_optional(db)
    .await?;

    if let Some(row) = email_level {
        return Ok(Some(row.is_important));
    }

    let domain_level = sqlx::query!(
        r#"
        SELECT ef.is_important
        FROM email_contacts c
        JOIN email_filters ef
          ON ef.link_id = $2
         AND ef.email_domain IS NOT NULL
         AND LOWER(ef.email_domain) = LOWER(split_part(c.email_address, '@', 2))
        WHERE c.id = $1
        AND NOT EXISTS (
            SELECT 1
            FROM email_filters ef_addr
            WHERE ef_addr.link_id = $2
              AND ef_addr.email_address IS NOT NULL
              AND LOWER(ef_addr.email_address) = LOWER(c.email_address)
              AND ef_addr.is_important != ef.is_important
        )
        LIMIT 1
        "#,
        from_contact_id,
        link_id,
    )
    .fetch_optional(db)
    .await?;

    Ok(domain_level.map(|row| row.is_important))
}
