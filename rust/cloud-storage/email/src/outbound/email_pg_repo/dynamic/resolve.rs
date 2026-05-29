use filter_ast::Expr;
use item_filters::ast::email::{Email, EmailLiteral};
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

/// Caches lookups that are repeated thousands of times inside the address
/// filter — `email_contacts.id`s for each Complete email referenced by the
/// AST, plus the `email_labels.id`s for the TRASH label. Resolving once up
/// front lets the candidate WHERE use direct id equality instead of joining
/// `email_contacts` / `email_labels` per message row.
///
/// Both fields are Vec-valued to support team-scoped queries, where the same
/// email address may resolve to multiple `email_contacts` rows (one per team
/// member's `link_id`) and the TRASH label exists once per link. For the
/// normal per-link path the Vecs typically contain one element.
pub(super) struct ResolvedFilters {
    /// Lowercased email address → all contact ids that match across the
    /// resolved scope (one link, or all team links). Empty Vec means the
    /// address has no matching contact anywhere in scope.
    contact_ids: HashMap<String, Vec<Uuid>>,
    /// All TRASH label ids in scope. One id per link with a TRASH label.
    /// Empty when no scope-relevant link has a TRASH label (rare).
    trash_label_ids: Vec<Uuid>,
}

impl ResolvedFilters {
    /// Returns the resolved contact ids for a Complete email, or `None` for
    /// unresolved Completes and Partial/Domain emails. Unresolved Completes
    /// will be emitted as `FALSE` by the SQL builder.
    pub(super) fn contact_ids_for(&self, email: &Email) -> Option<&[Uuid]> {
        match email {
            Email::Complete(e) => {
                let lowered = e.0.as_ref().to_lowercase();
                self.contact_ids
                    .get(&lowered)
                    .filter(|ids| !ids.is_empty())
                    .map(|ids| ids.as_slice())
            }
            Email::Partial(_) | Email::Domain(_) => None,
        }
    }

    pub(super) fn trash_label_ids(&self) -> &[Uuid] {
        &self.trash_label_ids
    }

    /// True iff at least one Complete email address in the AST has any
    /// matching contact in the resolved scope. Used by `fold_unresolved`.
    fn has_contact_for(&self, lowered_email: &str) -> bool {
        self.contact_ids
            .get(lowered_email)
            .map(|ids| !ids.is_empty())
            .unwrap_or(false)
    }

    #[cfg(test)]
    pub(super) fn empty() -> Self {
        Self {
            contact_ids: HashMap::new(),
            trash_label_ids: Vec::new(),
        }
    }

    #[cfg(test)]
    pub(super) fn with_contact(mut self, lowered_email: impl Into<String>, id: Uuid) -> Self {
        self.contact_ids
            .entry(lowered_email.into())
            .or_default()
            .push(id);
        self
    }

    #[cfg(test)]
    pub(super) fn with_trash(mut self, id: Uuid) -> Self {
        self.trash_label_ids.push(id);
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
                if resolved.has_contact_for(&lowered) {
                    None
                } else {
                    Some(false)
                }
            }
            Email::Partial(_) | Email::Domain(_) => None,
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
/// the TRASH label id(s) for the scope.
///
/// When `team_id` is `None`, the scope is the single `link_id` (normal
/// per-mailbox query) and each address resolves to at most one contact_id;
/// the TRASH lookup returns at most one label id.
///
/// When `team_id` is `Some`, the scope expands to every `link_id` owned by
/// any user on the team. The same email address may now resolve to multiple
/// contact_ids (one per team member who has corresponded with that address),
/// and the TRASH lookup returns one label id per team link. The SQL builder
/// uses `= ANY($ids)` predicates so messages in *any* team mailbox match.
#[tracing::instrument(skip(pool, ast), err)]
pub(super) async fn resolve_filters(
    pool: &PgPool,
    link_ids: &[Uuid],
    team_id: Option<Uuid>,
    ast: &Expr<EmailLiteral>,
) -> Result<ResolvedFilters, sqlx::Error> {
    let trash_label_ids: Vec<Uuid> = match team_id {
        None => {
            sqlx::query_scalar!(
                r#"
            SELECT id
            FROM email_labels
            WHERE link_id = ANY($1) AND name = 'TRASH'
            "#,
                link_ids,
            )
            .fetch_all(pool)
            .await?
        }
        Some(team_id) => {
            sqlx::query_scalar!(
                r#"
            SELECT l.id
            FROM email_labels l
            JOIN email_links el ON el.id = l.link_id
            JOIN team_user tu ON tu.user_id = el.macro_id
            WHERE l.name = 'TRASH' AND tu.team_id = $1
            "#,
                team_id,
            )
            .fetch_all(pool)
            .await?
        }
    };

    let emails = collect_complete_emails(ast);
    let mut contact_ids: HashMap<String, Vec<Uuid>> = HashMap::new();
    if !emails.is_empty() {
        // Project each arm's anonymous `Record` into a common `(Uuid, String)`
        // shape — `sqlx::query!` generates a distinct struct per call site, so
        // the `match` arms can't share a return type otherwise.
        let rows: Vec<(Uuid, String)> = match team_id {
            None => sqlx::query!(
                r#"
                SELECT id, LOWER(email_address) AS "email_lower!"
                FROM email_contacts
                WHERE link_id = ANY($1) AND LOWER(email_address) = ANY($2)
                "#,
                link_ids,
                &emails,
            )
            .fetch_all(pool)
            .await?
            .into_iter()
            .map(|r| (r.id, r.email_lower))
            .collect(),
            Some(team_id) => sqlx::query!(
                r#"
                SELECT c.id, LOWER(c.email_address) AS "email_lower!"
                FROM email_contacts c
                JOIN email_links el ON el.id = c.link_id
                JOIN team_user tu ON tu.user_id = el.macro_id
                WHERE tu.team_id = $1
                  AND LOWER(c.email_address) = ANY($2)
                "#,
                team_id,
                &emails,
            )
            .fetch_all(pool)
            .await?
            .into_iter()
            .map(|r| (r.id, r.email_lower))
            .collect(),
        };

        for (id, email_lower) in rows {
            contact_ids.entry(email_lower).or_default().push(id);
        }
    }

    Ok(ResolvedFilters {
        contact_ids,
        trash_label_ids,
    })
}
