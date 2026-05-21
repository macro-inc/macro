use entity_access::domain::models::EntityAccessReceipt;
use entity_access::domain::models::MemberTeamRole;
use filter_ast::Expr;
use item_filters::ast::email::{Email, EmailLiteral};

use crate::domain::{
    models::{
        EmailErr, EnrichedEmailThreadPreview, GetEmailsRequest, PreviewCursorQuery, UserProvider,
    },
    ports::EmailRepo,
};
use frecency::domain::{
    models::{AggregateId, FrecencyByIdsRequest, FrecencyData},
    ports::FrecencyQueryService,
};
use item_filters::ast::LiteralTree;
use macro_user_id::cowlike::CowLike;
use macro_user_id::email::ReadEmailParts;
use model_entity::EntityType;
use models_pagination::{CollectBy, PaginateOn, PaginatedCursor, SimpleSortMethod};
use std::collections::{HashMap, HashSet};
use uuid::Uuid;

use super::EmailServiceImpl;

impl<T, U, E, CS> EmailServiceImpl<T, U, E, CS>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: crate::domain::ports::EmailMessageEnqueuer,
    CS: crm::domain::service::CrmService,
    anyhow::Error: From<T::Err>,
{
    #[tracing::instrument(err, skip(self, req))]
    pub(crate) async fn get_email_thread_previews_impl(
        &self,
        req: GetEmailsRequest,
    ) -> Result<PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>, EmailErr>
    {
        let GetEmailsRequest {
            view,
            link_id,
            macro_id,
            limit,
            query,
            team_receipt,
        } = req;

        let team_id = self
            .validate_team_scope(team_receipt.as_ref(), query.filter())
            .await?;

        let sort_method = *query.sort_method();

        const MIN_PAGE: u32 = 20;
        const MAX_PAGE: u32 = 500;

        let limit = limit.unwrap_or_default().clamp(MIN_PAGE, MAX_PAGE);

        let query = PreviewCursorQuery {
            view,
            link_id,
            limit,
            query,
            team_id,
        };

        let previews = self
            .email_repo
            .previews_for_view_cursor(query, macro_id.copied().into_owned())
            .await
            .map_err(anyhow::Error::from)?;

        let thread_ids: Vec<Uuid> = previews.iter().map(|p| p.id).collect();

        let ids: Vec<_> = thread_ids
            .iter()
            .map(|id| EntityType::EmailThread.with_entity_string(id.to_string()))
            .collect();

        let frecency_request = FrecencyByIdsRequest {
            user_id: macro_id,
            ids: ids.as_slice(),
        };

        let (attachment_map_result, participant_result, labels_result, frecency_scores) = tokio::join!(
            self.email_repo.attachments_by_thread_ids(&thread_ids),
            self.email_repo.contacts_by_thread_ids(&thread_ids),
            self.email_repo.labels_by_thread_ids(&thread_ids),
            self.frecency_service
                .get_frecencies_by_ids(frecency_request)
        );

        let mut attachment_map = attachment_map_result
            .map_err(anyhow::Error::from)?
            .into_iter()
            .group_by(|v| v.thread_id);
        let mut participant_map = participant_result
            .map_err(anyhow::Error::from)?
            .into_iter()
            .group_by(|v| v.thread_id);
        let mut labels_map = labels_result
            .map_err(anyhow::Error::from)?
            .into_iter()
            .group_by(|v| v.thread_id);

        let mut frecency_scores_map: HashMap<AggregateId<'static>, FrecencyData> =
            frecency_scores?.into_inner();

        Ok(previews
            .into_iter()
            .map(|thread| {
                let id = AggregateId {
                    user_id: thread.owner_id.clone(),
                    entity: EntityType::EmailThread.with_entity_string(thread.id.to_string()),
                };

                EnrichedEmailThreadPreview {
                    attachments: attachment_map.remove(&thread.id).unwrap_or_default(),
                    labels: labels_map.remove(&thread.id).unwrap_or_default(),
                    participants: participant_map.remove(&thread.id).unwrap_or_default(),
                    frecency_score: frecency_scores_map
                        .remove(&id)
                        .map(|data| id.into_aggregate(data)),
                    thread,
                }
            })
            .paginate_on(limit as usize, sort_method)
            .into_page())
    }

    pub(crate) async fn get_link_by_auth_id_and_macro_id_impl(
        &self,
        auth_id: &str,
        macro_id: macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<Option<crate::domain::models::Link>, EmailErr> {
        Ok(self
            .email_repo
            .link_by_fusionauth_and_macro_id(auth_id, macro_id, UserProvider::Gmail)
            .await
            .map_err(anyhow::Error::from)?)
    }

    /// Verify that a query is allowed to run team-scoped behavior.
    ///
    /// Three layered checks, in order:
    ///   1. Did the query actually request `EmailLiteral::TeamScope`? If not,
    ///      this is a normal per-mailbox query — no further checks apply.
    ///   2. Is a team-membership receipt present? If not, the caller asked
    ///      for team-wide visibility without proof of team membership —
    ///      reject as `Unauthorized`. (This shouldn't happen via the soup
    ///      handler, which 403s upstream, but the email service is the
    ///      resource boundary and validates defensively.)
    ///   3. For each `Email::Domain(_)` literal in the AST, the team must
    ///      have a CRM organization tracking that domain with
    ///      `email_sync = true`. Otherwise the team has not opted into
    ///      sharing emails for that domain — reject the query.
    ///
    /// Returns `Some(team_id)` when team_scope was requested AND the receipt
    /// passed all checks (membership, domain authorization). `None` when
    /// team_scope wasn't requested — the caller should run the normal
    /// per-link query path.
    async fn validate_team_scope(
        &self,
        team_receipt: Option<&EntityAccessReceipt<MemberTeamRole>>,
        filter: &LiteralTree<EmailLiteral>,
    ) -> Result<Option<Uuid>, EmailErr> {
        if !filter_requests_team_scope(filter) {
            return Ok(None);
        }

        // Reject any `Email::Partial(_)` address under team_scope. The typed
        // POST endpoint catches this at AST expansion via
        // `ExpandErr::TeamScopeRequiresQualifiedEmail`, but the raw AST
        // endpoint bypasses that path — a `Partial` would otherwise become
        // a team-wide `ILIKE` substring search across teammate mailboxes,
        // skipping the qualified-address rule and the CRM domain-consent
        // gate. Reject here defensively.
        if filter_contains_partial_address(filter) {
            return Err(EmailErr::Unauthorized);
        }

        let receipt = team_receipt.ok_or(EmailErr::Unauthorized)?;

        let team_id = Uuid::parse_str(&receipt.entity().entity_id).map_err(|e| {
            EmailErr::RepoErr(anyhow::anyhow!(
                "team_receipt entity_id is not a valid uuid: {e}"
            ))
        })?;

        let domains = collect_domain_literals(filter);
        if domains.is_empty() {
            return Ok(Some(team_id));
        }

        for domain in domains {
            let company = self
                .crm_service
                .get_company_by_domain(&team_id, &domain)
                .await
                .map_err(|e| EmailErr::RepoErr(anyhow::anyhow!("crm lookup failed: {e}")))?;

            match company {
                Some(company) if company.email_sync => {}
                _ => return Err(EmailErr::DomainNotPermittedForTeamScope(domain)),
            }
        }

        Ok(Some(team_id))
    }
}

/// Walks an email-filter AST and returns the deduped set of domains that
/// require CRM `email_sync` authorization under team_scope.
///
/// Sources:
///   - `Email::Domain(d)` → `d` directly. The literal IS a domain.
///   - `Email::Complete(addr)` → `addr.domain_part()`. The team_scope rule
///     is "the address's company must have email_sync enabled", so an exact
///     address like `alice@acme.com` is governed by acme.com's CRM company,
///     not by whether alice is individually in `crm_contacts`.
///   - `Email::Partial(_)` → not handled here. `validate_team_scope` rejects
///     Partial+team_scope upfront via `filter_contains_partial_address`, so
///     this walker only sees Domain/Complete by the time it runs.
fn collect_domain_literals(filter: &LiteralTree<EmailLiteral>) -> HashSet<String> {
    fn walk(expr: &Expr<EmailLiteral>, out: &mut HashSet<String>) {
        match expr {
            Expr::And(a, b) | Expr::Or(a, b) => {
                walk(a, out);
                walk(b, out);
            }
            Expr::Not(a) => walk(a, out),
            Expr::Literal(
                EmailLiteral::Sender(email)
                | EmailLiteral::Cc(email)
                | EmailLiteral::Bcc(email)
                | EmailLiteral::Recipient(email),
            ) => match email {
                Email::Domain(d) => {
                    out.insert(d.to_ascii_lowercase());
                }
                Email::Complete(addr) => {
                    out.insert(addr.0.domain_part().to_ascii_lowercase());
                }
                Email::Partial(_) => {}
            },
            Expr::Literal(_) => {}
        }
    }
    let mut out = HashSet::new();
    if let Some(expr) = filter.as_ref() {
        walk(expr, &mut out);
    }
    out
}

/// Walks an email-filter AST and returns true if any node is the
/// `EmailLiteral::TeamScope` literal. Used to gate team-scope-specific
/// validation/expansion: without this literal the caller is not asking for
/// team-wide visibility, so checks like CRM domain authorization don't apply.
fn filter_requests_team_scope(filter: &LiteralTree<EmailLiteral>) -> bool {
    fn walk(expr: &Expr<EmailLiteral>) -> bool {
        match expr {
            Expr::And(a, b) | Expr::Or(a, b) => walk(a) || walk(b),
            Expr::Not(a) => walk(a),
            Expr::Literal(EmailLiteral::TeamScope) => true,
            Expr::Literal(_) => false,
        }
    }
    filter.as_ref().map(|e| walk(e)).unwrap_or(false)
}

/// Walks an email-filter AST and returns true if any Sender/Cc/Bcc/Recipient
/// literal carries an `Email::Partial(_)`. Partial is a substring fragment
/// (the trigram-indexed ILIKE path) and must not appear under team_scope —
/// the typed POST endpoint already rejects this combination at AST
/// expansion (`ExpandErr::TeamScopeRequiresQualifiedEmail`), but the raw
/// AST endpoint bypasses that path, so this is the defensive check at the
/// email-service boundary.
fn filter_contains_partial_address(filter: &LiteralTree<EmailLiteral>) -> bool {
    fn walk(expr: &Expr<EmailLiteral>) -> bool {
        match expr {
            Expr::And(a, b) | Expr::Or(a, b) => walk(a) || walk(b),
            Expr::Not(a) => walk(a),
            Expr::Literal(
                EmailLiteral::Sender(Email::Partial(_))
                | EmailLiteral::Cc(Email::Partial(_))
                | EmailLiteral::Bcc(Email::Partial(_))
                | EmailLiteral::Recipient(Email::Partial(_)),
            ) => true,
            Expr::Literal(_) => false,
        }
    }
    filter.as_ref().map(|e| walk(e)).unwrap_or(false)
}
