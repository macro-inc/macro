use filter_ast::Expr;
use item_filters::ast::email::{Email, EmailLiteral};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

/// Caches lookups that are repeated thousands of times inside the address
/// filter — `email_contacts.id` for each Complete email referenced by the
/// AST, plus the `email_labels.id` for the per-link TRASH label. Resolving
/// once up front lets the candidate WHERE use direct id equality instead of
/// joining `email_contacts` / `email_labels` per message row.
pub(super) struct ResolvedFilters {
    /// Lowercased email address → contact id, for every Complete address in
    /// the AST that has a row in `email_contacts` for this link.
    contact_ids: HashMap<String, Uuid>,
    /// The TRASH label id for this link, if one exists.
    trash_label_id: Option<Uuid>,
}

impl ResolvedFilters {
    /// Returns the resolved contact id for a Complete email, or `None` for
    /// unresolved Completes and Partial emails. Unresolved Completes will
    /// be emitted as `FALSE` by the SQL builder.
    pub(super) fn contact_id_for(&self, email: &Email) -> Option<Uuid> {
        match email {
            Email::Complete(e) => {
                let lowered = e.0.as_ref().to_lowercase();
                self.contact_ids.get(&lowered).copied()
            }
            Email::Partial(_) => None,
        }
    }

    pub(super) fn trash_label_id(&self) -> Option<Uuid> {
        self.trash_label_id
    }

    #[cfg(test)]
    pub(super) fn empty() -> Self {
        Self {
            contact_ids: HashMap::new(),
            trash_label_id: None,
        }
    }

    #[cfg(test)]
    pub(super) fn with_contact(mut self, lowered_email: impl Into<String>, id: Uuid) -> Self {
        self.contact_ids.insert(lowered_email.into(), id);
        self
    }

    #[cfg(test)]
    pub(super) fn with_trash(mut self, id: Uuid) -> Self {
        self.trash_label_id = Some(id);
        self
    }
}

/// Walks the AST collecting every Complete email address (lowercased,
/// deduplicated) so they can be resolved in one DB round trip.
pub(super) fn collect_complete_emails(ast: &Expr<EmailLiteral>) -> Vec<String> {
    fn walk(e: &Expr<EmailLiteral>, out: &mut Vec<String>) {
        match e {
            Expr::And(a, b) | Expr::Or(a, b) => {
                walk(a, out);
                walk(b, out);
            }
            Expr::Not(a) => walk(a, out),
            Expr::Literal(lit) => match lit {
                EmailLiteral::Sender(Email::Complete(e))
                | EmailLiteral::Cc(Email::Complete(e))
                | EmailLiteral::Bcc(Email::Complete(e))
                | EmailLiteral::Recipient(Email::Complete(e)) => {
                    out.push(e.0.as_ref().to_lowercase());
                }
                _ => {}
            },
        }
    }
    let mut out = Vec::new();
    walk(ast, &mut out);
    out.sort();
    out.dedup();
    out
}

/// Constant-folds the AST treating unresolved Complete emails as `FALSE`.
/// Returns `Some(b)` when the whole AST collapses to a constant under that
/// substitution, `None` otherwise. A `Some(false)` result means no thread
/// can match — the caller can short-circuit to an empty page without
/// running the main query.
pub(super) fn fold_unresolved(
    ast: &Expr<EmailLiteral>,
    resolved: &ResolvedFilters,
) -> Option<bool> {
    fn lit_value(literal: &EmailLiteral, resolved: &ResolvedFilters) -> Option<bool> {
        let email = match literal {
            EmailLiteral::Sender(e)
            | EmailLiteral::Cc(e)
            | EmailLiteral::Bcc(e)
            | EmailLiteral::Recipient(e) => e,
            _ => return None,
        };
        match email {
            Email::Complete(e) => {
                let lowered = e.0.as_ref().to_lowercase();
                if resolved.contact_ids.contains_key(&lowered) {
                    None
                } else {
                    Some(false)
                }
            }
            Email::Partial(_) => None,
        }
    }

    match ast {
        Expr::And(a, b) => match (fold_unresolved(a, resolved), fold_unresolved(b, resolved)) {
            (Some(false), _) | (_, Some(false)) => Some(false),
            (Some(true), x) | (x, Some(true)) => x,
            (None, None) => None,
        },
        Expr::Or(a, b) => match (fold_unresolved(a, resolved), fold_unresolved(b, resolved)) {
            (Some(true), _) | (_, Some(true)) => Some(true),
            (Some(false), x) | (x, Some(false)) => x,
            (None, None) => None,
        },
        Expr::Not(a) => fold_unresolved(a, resolved).map(|b| !b),
        Expr::Literal(lit) => lit_value(lit, resolved),
    }
}

/// True when the AST cannot match any thread because at least one
/// positive-polarity Complete email has no contact in this link. Caller
/// should return an empty result without running the main query.
pub(super) fn can_short_circuit(ast: &Expr<EmailLiteral>, resolved: &ResolvedFilters) -> bool {
    matches!(fold_unresolved(ast, resolved), Some(false))
}

/// Resolves all Complete emails in the AST to `contact_id`s and looks up
/// the TRASH label id for the link in one (or two) DB round trip(s).
#[tracing::instrument(skip(pool, ast), err)]
pub(super) async fn resolve_filters(
    pool: &PgPool,
    link_id: Uuid,
    ast: &Expr<EmailLiteral>,
) -> Result<ResolvedFilters, sqlx::Error> {
    let trash_label_id: Option<Uuid> = sqlx::query_scalar!(
        r#"
        SELECT id
        FROM email_labels
        WHERE link_id = $1 AND name = 'TRASH'
        LIMIT 1
        "#,
        link_id,
    )
    .fetch_optional(pool)
    .await?;

    let emails = collect_complete_emails(ast);
    let contact_ids = if emails.is_empty() {
        HashMap::new()
    } else {
        let rows = sqlx::query!(
            r#"
            SELECT id, LOWER(email_address) AS "email_lower!"
            FROM email_contacts
            WHERE link_id = $1 AND LOWER(email_address) = ANY($2)
            "#,
            link_id,
            &emails,
        )
        .fetch_all(pool)
        .await?;

        rows.into_iter()
            .map(|r| (r.email_lower, r.id))
            .collect::<HashMap<_, _>>()
    };

    Ok(ResolvedFilters {
        contact_ids,
        trash_label_id,
    })
}
