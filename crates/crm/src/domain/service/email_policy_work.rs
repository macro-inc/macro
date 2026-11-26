use super::*;
use crate::domain::{
    email_policy::*,
    email_policy_work::*,
    email_rules::{EmailContributionMode, EmailPolicyActorKind, EmailPolicyAuditAction},
};
use uuid::Uuid;

/// Reauthorize only the named slot. A version change within the same lifetime
/// restarts history durably; a different lifetime is never opened by this job.
async fn current_history<T: EmailPolicyHistoryTransaction>(
    tx: &mut T,
    request: &EmailPolicyWorkRequest,
) -> Result<
    Option<(
        EmailPolicyHistoryWork,
        super::super::email_privacy::EmailContributionMailbox,
    )>,
    CrmError,
> {
    let Some(work) = tx.history_work().await? else {
        return Ok(None);
    };
    if work.request != *request || tx.state().link_id != request.link_id {
        return Ok(None);
    }
    let mailbox = tx.history_mailbox().await?;
    if !(tx.state().enabled || tx.state().selected_enabled) {
        tx.finish_history_page(request, &work.cursor, None).await?;
        return Ok(None);
    }
    // Reauthorization may be temporary. Keep durable history for reconnect;
    // lifecycle withdrawal instead clears the grant and retires above.
    if mailbox.is_none() {
        return Err(CrmError::Contended);
    }
    if tx.state().generation != request.generation {
        // The old job is still the slot occupant. Replacing it from the start
        // preserves unfinished eligible history after either narrowing or widening.
        tx.request_work(Uuid::now_v7(), None).await?;
        return Ok(None);
    }
    Ok(mailbox.map(|mailbox| (work, mailbox)))
}

impl<CR, R> EmailPolicyWorkService for CrmServiceImpl<CR, R>
where
    CR: CompaniesRepository + EmailPolicyWorkRepository + EmailHistoryPopulationRepository,
    R: CompanyMetadataResolver,
{
    async fn legacy_history_mailbox(
        &self,
        team: Uuid,
        user: &str,
    ) -> Result<Option<super::super::email_privacy::EmailContributionMailbox>, CrmError> {
        self.companies_repository
            .legacy_history_mailbox(team, user)
            .await
    }

    #[tracing::instrument(name = "crm.email_history.page", skip_all, fields(team_id = %request.team_id, work_id = %request.work_id), err)]
    async fn history_page(
        &self,
        request: &EmailPolicyWorkRequest,
    ) -> Result<Option<EmailPolicyHistoryPage>, CrmError> {
        let Some(mut tx) = self.companies_repository.open_history(request).await? else {
            return Ok(None);
        };
        let page = if let Some((work, mailbox)) = current_history(&mut tx, request).await? {
            let contacts = tx
                .history_contacts(work.cursor.after_contact_address.as_deref())
                .await?;
            Some(EmailPolicyHistoryPage {
                mailbox,
                cursor: work.cursor,
                contacts,
            })
        } else {
            None
        };
        tx.commit().await?;
        Ok(page)
    }

    #[tracing::instrument(name = "crm.email_history.contact", skip_all, fields(team_id = %team, link_id = %link), err)]
    async fn populate_history_contact(
        &self,
        team: Uuid,
        link: Uuid,
        user_email: &str,
        email: &str,
        name: Option<&str>,
        authority: EmailHistoryAuthority,
        sent_only: bool,
    ) -> Result<(), CrmError> {
        let email = email.trim().to_ascii_lowercase();
        let Some((local, domain)) = email.split_once('@') else {
            return Ok(());
        };
        if local.is_empty() || domain.is_empty() || domain.contains('@') {
            return Ok(());
        }
        let personal = is_personal_email_domain(domain);
        if email.eq_ignore_ascii_case(user_email.trim())
            || (!personal
                && user_email
                    .trim()
                    .split_once('@')
                    .is_some_and(|(local, own)| {
                        !local.is_empty() && own.eq_ignore_ascii_case(domain)
                    }))
        {
            return Ok(());
        }
        if !personal && is_generic_email_domain(domain) {
            return Ok(());
        }
        let Some(interaction) = self
            .companies_repository
            .history_interactions(team, link, &email, authority)
            .await?
        else {
            return Ok(());
        };
        if sent_only && !interaction.is_sent {
            return Ok(());
        }
        if !personal && interaction.is_sent {
            self.ensure_domain_directory_entry(domain).await?;
        }
        self.companies_repository
            .populate_history_contact(
                team,
                link,
                domain,
                &email,
                name,
                personal,
                authority,
                &interaction,
            )
            .await
    }

    #[tracing::instrument(name = "crm.email_history.checkpoint", skip_all, fields(team_id = %request.team_id, work_id = %request.work_id), err)]
    async fn finish_history_page(
        &self,
        request: &EmailPolicyWorkRequest,
        page: &EmailPolicyHistoryPage,
    ) -> Result<(), CrmError> {
        let Some(mut tx) = self.companies_repository.open_history(request).await? else {
            return Ok(());
        };
        if current_history(&mut tx, request).await?.is_some() {
            let next = if page.contacts.len() == 100 {
                page.contacts.last().map(|c| EmailPolicyHistoryCursor {
                    received_pass: page.cursor.received_pass,
                    after_contact_address: Some(c.address.clone()),
                })
            } else if !page.cursor.received_pass {
                Some(EmailPolicyHistoryCursor {
                    received_pass: true,
                    after_contact_address: None,
                })
            } else {
                None
            };
            tx.finish_history_page(request, &page.cursor, next.as_ref())
                .await?;
        }
        tx.commit().await
    }

    async fn reconcile_source_page(&self) -> Result<bool, CrmError> {
        use tracing::Instrument;
        let Some(mut event) = self.companies_repository.next_source_event().await? else {
            return Ok(false);
        };
        let source = event.event().clone();
        let span = tracing::info_span!("crm.email_history.source", team_id = %source.team_id, event_id = %source.event_id, outcome = tracing::field::Empty);
        event.adopt_trace(&span);
        async {
            let result: Result<bool, CrmError> = async {
                let references = event.references().await?;
                for candidate in event.source_candidates(&references).await? {
                    let Some(mut tx) = self
                        .companies_repository
                        .open_source_policy(source.team_id, &candidate)
                        .await?
                    else {
                        continue;
                    };
                    let state = tx.state();
                    if state.generation == candidate.generation
                        && state.mode == EmailContributionMode::Selected
                        && state.selected_enabled
                        && state.active_rule_revision == Some(candidate.reference.revision)
                        && tx.history_mailbox().await?.is_some()
                    {
                        // The event UUIDv7 is scoped by member/incarnation. A later
                        // version already owns its own history or the old job's
                        // durable transfer; replaying this event must not reset it.
                        let work_id = source.event_id;
                        let first_delivery = tx.idempotency(work_id).await?.is_none();
                        if first_delivery {
                            tx.request_work(work_id, source.traceparent.as_deref())
                                .await?;
                            tx.record_audit(&NewEmailPolicyAudit {
                            event_id: Uuid::now_v7(),
                            action: EmailPolicyAuditAction::LiveTargetsChanged,
                            actor_kind: EmailPolicyActorKind::System,
                            agent_id: None,
                            agent_session_id: None,
                            previous_revision: Some(candidate.reference.revision),
                            next_revision: Some(candidate.reference.revision),
                            details: serde_json::json!({"source_kind": match source.source_kind {
                                EmailPolicySourceKind::Contact => "contact",
                                EmailPolicySourceKind::Company => "company",
                                EmailPolicySourceKind::Team => "team",
                            }}),
                        })
                        .await?;
                        }
                    }
                    tx.commit().await?;
                }
                event.advance(references.last()).await?;
                event.commit().await?;
                Ok(true)
            }
            .await;
            tracing::Span::current()
                .record("outcome", if result.is_ok() { "success" } else { "error" });
            if let Err(error) = &result {
                tracing::error!(error = ?error, "failed to reconcile CRM email policy source page");
            }
            result
        }
        .instrument(span)
        .await
    }
}
