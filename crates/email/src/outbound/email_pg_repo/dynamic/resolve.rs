use filter_ast::Expr;
use item_filters::ast::email::{Email, EmailLiteral};
use sqlx::{PgConnection, PgPool};
use std::collections::HashMap;
use std::time::Instant;

use super::query::limit_statement_time;
use uuid::Uuid;

/// Cache mailbox-scoped contact identities for address predicates and team scope.
#[derive(Clone, Default)]
pub(super) struct ResolvedFilters {
    /// Only the explicit Trash view may admit present messages in trash.
    pub(super) include_trash: bool,
    /// Lowercased email address → all contact ids that match across the
    /// resolved scope (one link, or all team links). Empty Vec means the
    /// address has no matching contact anywhere in scope.
    contact_ids: HashMap<String, Vec<Uuid>>,
    /// Each resolved contact's inbox (`email_contacts.link_id`).
    contact_links: HashMap<Uuid, Uuid>,
    /// Every primary `email_links.id` owned by a member of the query's team.
    /// `Some` only for team-scoped queries. Doubles as the candidate-stage
    /// `t.link_id = ANY(…)` set and (for non-shared, non-project queries)
    /// the `matching_threads` link scope.
    team_link_ids: Option<Vec<Uuid>>,
    /// The team links whose threads CRM may show when this resolution ran:
    /// primary, not being deleted, with the owner's consent for this team
    /// (`crm_email_thread_allowed`'s mailbox conditions). `Some` only for
    /// team-scoped queries. The query rechecks them as it reads.
    contributing_link_ids: Option<Vec<Uuid>>,
    /// Contributing links in selected mode. Optimized Team reads resolve this
    /// partition in the same snapshot as their candidate and eligibility SQL.
    selected_link_ids: Option<Vec<Uuid>>,
    /// The inboxes whose contacts a domain or partial address matches on a
    /// message, or `None` for every inbox. Complete addresses resolve to
    /// contacts of the queried inboxes already.
    text_match_links: Option<Vec<Uuid>>,
    /// Selected Team reads fence the known contact ID before testing its text.
    fenced_text_matches: bool,
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

    /// The team's primary link ids, when this resolution was team-scoped.
    pub(super) fn team_link_ids(&self) -> Option<&[Uuid]> {
        self.team_link_ids.as_deref()
    }

    /// The inboxes a domain or partial address's contacts must belong to.
    pub(super) fn text_match_links(&self) -> Option<&[Uuid]> {
        self.text_match_links.as_deref()
    }

    /// This resolution with domain and partial addresses matching only
    /// contacts of `links`.
    pub(super) fn text_matches_within(&self, links: &[Uuid]) -> Self {
        Self {
            text_match_links: Some(links.to_vec()),
            ..self.clone()
        }
    }

    pub(super) fn fenced_text_matches_within(&self, links: &[Uuid]) -> Self {
        Self {
            text_match_links: Some(links.to_vec()),
            fenced_text_matches: true,
            ..self.clone()
        }
    }

    pub(super) fn fenced_text_matches(&self) -> bool {
        self.fenced_text_matches
    }

    /// The team links that contributed to CRM when this resolution ran.
    pub(super) fn contributing_link_ids(&self) -> Option<&[Uuid]> {
        self.contributing_link_ids.as_deref()
    }

    pub(super) fn selected_link_ids(&self) -> Option<&[Uuid]> {
        self.selected_link_ids.as_deref()
    }

    /// This resolution with only the contacts of `links`' inboxes. A message
    /// lists only its own inbox's contacts, so the others can't match there.
    pub(super) fn within_links(&self, links: &[Uuid]) -> Self {
        let in_links = |id: &Uuid| {
            self.contact_links
                .get(id)
                .is_some_and(|link| links.contains(link))
        };
        Self {
            include_trash: self.include_trash,
            contact_ids: self
                .contact_ids
                .iter()
                .map(|(email, ids)| {
                    (
                        email.clone(),
                        ids.iter().copied().filter(in_links).collect(),
                    )
                })
                .collect(),
            contact_links: self
                .contact_links
                .iter()
                .filter(|(id, _)| in_links(id))
                .map(|(id, link)| (*id, *link))
                .collect(),
            team_link_ids: self.team_link_ids.clone(),
            contributing_link_ids: self.contributing_link_ids.clone(),
            selected_link_ids: self.selected_link_ids.clone(),
            text_match_links: self.text_match_links.clone(),
            fenced_text_matches: self.fenced_text_matches,
        }
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
        Self::default()
    }

    #[cfg(test)]
    pub(super) fn with_team_links(mut self, ids: Vec<Uuid>) -> Self {
        self.team_link_ids = Some(ids);
        self
    }

    #[cfg(test)]
    pub(super) fn with_contributing_links(mut self, ids: Vec<Uuid>) -> Self {
        self.contributing_link_ids = Some(ids);
        self
    }

    #[cfg(test)]
    pub(super) fn with_contact(
        mut self,
        lowered_email: impl Into<String>,
        id: Uuid,
        link: Uuid,
    ) -> Self {
        self.contact_ids
            .entry(lowered_email.into())
            .or_default()
            .push(id);
        self.contact_links.insert(id, link);
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

/// Resolve complete addresses within the requested links or the team's primary inboxes.
pub(super) async fn resolve_filters(
    pool: &PgPool,
    link_ids: &[Uuid],
    team_id: Option<Uuid>,
    ast: &Expr<EmailLiteral>,
) -> Result<ResolvedFilters, sqlx::Error> {
    if team_id.is_none() && collect_complete_emails(ast).is_empty() {
        return Ok(ResolvedFilters::default());
    }
    let mut connection = pool.acquire().await?;
    resolve_filters_on(&mut connection, link_ids, team_id, ast, None).await
}

/// Resolve on the caller's connection so mode selection shares its snapshot.
#[tracing::instrument(name = "resolve_filters", skip(connection, ast), err)]
pub(super) async fn resolve_filters_on(
    connection: &mut PgConnection,
    link_ids: &[Uuid],
    team_id: Option<Uuid>,
    ast: &Expr<EmailLiteral>,
    deadline: Option<Instant>,
) -> Result<ResolvedFilters, sqlx::Error> {
    let emails = collect_complete_emails(ast);
    // Team scope resolves to a concrete link-id set once, so every
    // downstream lookup (and the main query's candidate WHERE / CTE link
    // scope) is a direct `link_id = ANY($ids)` instead of re-joining
    // email_links/team_user per query.
    let (team_link_ids, contributing_link_ids, selected_link_ids) = match team_id {
        None => (None, None, None),
        Some(team_id) => {
            if let Some(deadline) = deadline {
                limit_statement_time(connection, deadline).await?;
            }
            // `contributing` restates crm_email_thread_allowed's mailbox
            // conditions; the team-scoped CRM query reads only these inboxes.
            let links = sqlx::query!(
                r#"
            SELECT el.id,
                   (el.deleting_at IS NULL AND COALESCE(
                       consent.enabled OR consent.selected_enabled, FALSE
                   )) AS "contributing!",
                   COALESCE(consent.selected_enabled, FALSE) AS "selected!"
            FROM email_links el
            JOIN team_user tu ON tu.user_id = el.macro_id
            LEFT JOIN crm_email_consent consent
              ON consent.team_id = $1 AND consent.user_id = el.macro_id
             AND consent.link_id = el.id
            WHERE tu.team_id = $1 AND el.is_primary
            "#,
                team_id,
            )
            .fetch_all(&mut *connection)
            .await?;
            let contributing = links
                .iter()
                .filter(|link| link.contributing)
                .map(|link| link.id)
                .collect();
            let selected = links
                .iter()
                .filter(|link| link.contributing && link.selected)
                .map(|link| link.id)
                .collect();
            (
                Some(links.into_iter().map(|link| link.id).collect()),
                Some(contributing),
                Some(selected),
            )
        }
    };
    let scope_link_ids: &[Uuid] = team_link_ids.as_deref().unwrap_or(link_ids);

    let mut contact_ids: HashMap<String, Vec<Uuid>> = HashMap::new();
    let mut contact_links: HashMap<Uuid, Uuid> = HashMap::new();
    if !emails.is_empty() {
        if let Some(deadline) = deadline {
            limit_statement_time(connection, deadline).await?;
        }
        let rows = sqlx::query!(
            r#"
                SELECT id, link_id, LOWER(email_address) AS "email_lower!"
                FROM email_contacts
                WHERE link_id = ANY($1) AND LOWER(email_address) = ANY($2)
                "#,
            scope_link_ids,
            &emails,
        )
        .fetch_all(&mut *connection)
        .await?;

        for row in rows {
            contact_ids.entry(row.email_lower).or_default().push(row.id);
            contact_links.insert(row.id, row.link_id);
        }
    }

    Ok(ResolvedFilters {
        include_trash: false,
        contact_ids,
        contact_links,
        team_link_ids,
        contributing_link_ids,
        selected_link_ids,
        text_match_links: None,
        fenced_text_matches: false,
    })
}
