//! This module exposes a dynamic query builder for email threads which can build specific
//! email queries that filter content based on input AST (EmailLiteral).

mod filters;
mod query;
mod resolve;

#[cfg(test)]
mod tests;

// Re-export the public API
pub(crate) use query::dynamic_email_thread_cursor;

// Re-export filter internals so tests.rs can reach them via `use super::*`
#[cfg(test)]
#[allow(unused_imports)]
pub(crate) use filters::*;

use sqlx::{Postgres, QueryBuilder};
use uuid::Uuid;

// ---------------------------------------------------------------------------
// SqlFragment: parameterized SQL builder that separates raw SQL from bind values
// ---------------------------------------------------------------------------

enum SqlSegment {
    Raw(String),
    BindString(String),
    BindUuid(Uuid),
    BindUuidArray(Vec<Uuid>),
}

struct SqlFragment {
    segments: Vec<SqlSegment>,
}

impl SqlFragment {
    fn empty() -> Self {
        Self { segments: vec![] }
    }

    fn raw(s: impl Into<String>) -> Self {
        Self {
            segments: vec![SqlSegment::Raw(s.into())],
        }
    }

    fn bind_string(s: impl Into<String>) -> Self {
        Self {
            segments: vec![SqlSegment::BindString(s.into())],
        }
    }

    fn bind_uuid(u: Uuid) -> Self {
        Self {
            segments: vec![SqlSegment::BindUuid(u)],
        }
    }

    fn bind_uuid_array(ids: impl Into<Vec<Uuid>>) -> Self {
        Self {
            segments: vec![SqlSegment::BindUuidArray(ids.into())],
        }
    }

    fn is_empty(&self) -> bool {
        self.segments.is_empty()
    }

    fn push_raw(&mut self, s: impl Into<String>) {
        self.segments.push(SqlSegment::Raw(s.into()));
    }

    fn extend(&mut self, other: Self) {
        self.segments.extend(other.segments);
    }

    fn and(a: Self, b: Self) -> Self {
        let mut f = Self::raw("(");
        f.extend(a);
        f.push_raw(" AND ");
        f.extend(b);
        f.push_raw(")");
        f
    }

    fn or(a: Self, b: Self) -> Self {
        let mut f = Self::raw("(");
        f.extend(a);
        f.push_raw(" OR ");
        f.extend(b);
        f.push_raw(")");
        f
    }

    fn not(a: Self) -> Self {
        let mut f = Self::raw("(NOT ");
        f.extend(a);
        f.push_raw(")");
        f
    }

    fn with_and_prefix(self) -> Self {
        if self.is_empty() {
            return self;
        }
        let mut f = Self::raw(" AND ");
        f.extend(self);
        f
    }

    fn push_into(self, builder: &mut QueryBuilder<'_, Postgres>) {
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
                SqlSegment::BindUuidArray(ids) => {
                    builder.push_bind(ids);
                }
            }
        }
    }
}

#[cfg(test)]
impl SqlFragment {
    fn to_debug_sql(&self) -> String {
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
                SqlSegment::BindUuidArray(ids) => {
                    bind_idx += 1;
                    let joined = ids
                        .iter()
                        .map(|u| u.to_string())
                        .collect::<Vec<_>>()
                        .join(",");
                    result.push_str(&format!("${bind_idx}[uuid_array=[{joined}]]"));
                }
            }
        }
        result
    }

    fn has_bind_string(&self, expected: &str) -> bool {
        self.segments
            .iter()
            .any(|s| matches!(s, SqlSegment::BindString(v) if v == expected))
    }

    /// True if `expected` is bound somewhere in this fragment — either as a
    /// single-uuid bind or as an element of a uuid-array bind. The array
    /// case exists because address-id resolution now returns
    /// `Vec<Uuid>` (one entry per link in scope) and the predicate uses
    /// `= ANY($ids)`. Existing tests that assert "this contact id is in the
    /// query" should still pass without caring which shape it's bound as.
    fn has_bind_uuid(&self, expected: &Uuid) -> bool {
        self.segments.iter().any(|s| match s {
            SqlSegment::BindUuid(v) => v == expected,
            SqlSegment::BindUuidArray(vs) => vs.contains(expected),
            _ => false,
        })
    }

    fn has_no_raw_containing(&self, needle: &str) -> bool {
        !self
            .segments
            .iter()
            .any(|s| matches!(s, SqlSegment::Raw(v) if v.contains(needle)))
    }
}
