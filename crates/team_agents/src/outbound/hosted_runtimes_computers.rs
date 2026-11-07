//! In-process computer purchases through the hosted runtimes domain service.

use hosted_runtimes::domain::ids::ComputerId;
use std::sync::Arc;

use harnesses::domain::{models::PersonaHealth, ports::HarnessRepo};

use hosted_runtimes::domain::{
    lifecycle::PaymentOutcome,
    models,
    ports::{Billing, BillingError, CompPolicy, ComputerRepo, NoComps},
    service::{Clock, ComputerError, ComputerService},
};
use uuid::Uuid;

use crate::domain::models::{
    BillingInterval, BrainHealth, ComputerPayment, ComputerPurchase, ComputerQuote, ComputerSize,
    ComputerSizeSpec, ComputerStatus, ComputerStatusKind, Persona, TeamAgentError,
};
use crate::domain::ports::Computers;

#[cfg(test)]
mod test;

/// Buys and manages computers using the same service as the team computers API.
pub struct HostedRuntimesComputers<Repo, Bill, Time, Harness, Policy = NoComps> {
    service: Arc<ComputerService<Repo, Bill, Time, Policy>>,
    repo: Repo,
    harnesses: Harness,
}

impl<Repo, Bill, Time, Harness, Policy> HostedRuntimesComputers<Repo, Bill, Time, Harness, Policy> {
    /// Shares the computer service and a clone of its repository.
    /// The repository supplies saved bootstrap personas for recovery.
    pub fn new(
        service: Arc<ComputerService<Repo, Bill, Time, Policy>>,
        repo: Repo,
        harnesses: Harness,
    ) -> Self {
        Self {
            service,
            repo,
            harnesses,
        }
    }
}

impl<Repo: ComputerRepo, Bill: Billing, Time: Clock, Harness: HarnessRepo, Policy: CompPolicy>
    Computers for HostedRuntimesComputers<Repo, Bill, Time, Harness, Policy>
{
    fn sizes(&self) -> Vec<ComputerSizeSpec> {
        self.service
            .catalog()
            .iter()
            .map(|entry| ComputerSizeSpec {
                size: entry.size,
                vcpus: entry.resources.vcpus.get(),
                memory_gb: entry.resources.memory_gib.get(),
                disk_gb: entry.resources.disk_gib.get(),
            })
            .collect()
    }

    #[tracing::instrument(skip_all, fields(%team_id, ?size), err)]
    async fn quote(
        &self,
        team_id: Uuid,
        size: ComputerSize,
    ) -> Result<ComputerQuote, TeamAgentError> {
        let quote = self
            .service
            .quote(team_id, size, &models::PurchaseBilling::Stripe)
            .await
            .map_err(error)?;
        let resources = self.service.size_spec(quote.size).map_err(error)?.resources;
        Ok(ComputerQuote {
            vcpus: resources.vcpus.get(),
            memory_gb: resources.memory_gib.get(),
            disk_gb: resources.disk_gib.get(),
            price_id: quote.price_id,
            amount: quote.amount,
            currency: quote.currency,
            interval: match quote.interval {
                models::BillingInterval::Month => BillingInterval::Month,
                models::BillingInterval::Year => BillingInterval::Year,
            },
        })
    }

    #[tracing::instrument(skip_all, fields(team_id = %purchase.team_id), err)]
    async fn purchase(&self, purchase: ComputerPurchase) -> Result<ComputerId, TeamAgentError> {
        self.purchase_with_billing(purchase, models::PurchaseBilling::Stripe)
            .await
    }

    async fn provision_comped(
        &self,
        purchase: ComputerPurchase,
    ) -> Result<ComputerId, TeamAgentError> {
        self.purchase_with_billing(
            purchase,
            models::PurchaseBilling::Comped {
                reason: crate::domain::included::INCLUDED_REASON.to_owned(),
            },
        )
        .await
    }

    #[tracing::instrument(skip_all, fields(%team_id, %computer_id), err)]
    async fn status(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, TeamAgentError> {
        let status = self
            .service
            .status(team_id, computer_id)
            .await
            .map_err(error)?;
        let mut status = computer_status(status)?;
        match self.brain_health(team_id, computer_id).await {
            Ok(brain) => status.brain = brain,
            Err(source) => {
                // Missing/unavailable observations must never reuse a stored
                // healthy status. The domain projects missing health as unhealthy.
                tracing::error!(error = ?source, %computer_id, "could not read brain health");
            }
        }
        Ok(status)
    }

    #[tracing::instrument(skip_all, fields(%team_id, %computer_id), err)]
    async fn harness_id(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<Option<harness_id::HarnessId>, TeamAgentError> {
        let computer = self
            .repo
            .get(computer_id)
            .await
            .map_err(TeamAgentError::internal)?
            .filter(|computer| computer.team_id() == team_id)
            .ok_or(TeamAgentError::NotFound)?
            .into_healthy()
            .map_err(|reason| {
                TeamAgentError::ComputerUnavailable(format!(
                    "the computer needs attention: {reason}"
                ))
            })?;
        Ok(computer.harness_id)
    }

    #[tracing::instrument(skip_all, fields(%team_id, %computer_id), err)]
    async fn persona(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<Persona, TeamAgentError> {
        let computer = self
            .repo
            .get(computer_id)
            .await
            .map_err(TeamAgentError::internal)?
            .filter(|computer| computer.team_id() == team_id)
            .ok_or(TeamAgentError::NotFound)?
            .into_healthy()
            .map_err(|reason| {
                TeamAgentError::ComputerUnavailable(format!(
                    "the computer needs attention: {reason}"
                ))
            })?;
        let persona = computer.persona.ok_or_else(|| {
            TeamAgentError::RetryUnavailable("the computer has no saved persona".to_string())
        })?;
        Ok(persona)
    }

    #[tracing::instrument(skip_all, fields(%team_id, %computer_id), err)]
    async fn retry(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<ComputerStatus, TeamAgentError> {
        self.service
            .retry(team_id, computer_id)
            .await
            .map_err(error)?;
        self.status(team_id, computer_id).await
    }

    #[tracing::instrument(skip_all, fields(%team_id, %computer_id), err)]
    async fn release(&self, team_id: Uuid, computer_id: ComputerId) -> Result<(), TeamAgentError> {
        let status = match self.service.status(team_id, computer_id).await {
            Ok(status) => status,
            Err(ComputerError::NotFound) => return Ok(()),
            Err(source) => return Err(error(source)),
        };
        if status.status == models::ComputerStatusKind::Released {
            return Ok(());
        }
        match self
            .service
            .release_now(team_id, computer_id, status.name.as_str())
            .await
        {
            Ok(_) | Err(ComputerError::NotFound) => Ok(()),
            Err(source) => Err(error(source)),
        }
    }
}

impl<Repo: ComputerRepo, Bill, Time, Harness: HarnessRepo, Policy>
    HostedRuntimesComputers<Repo, Bill, Time, Harness, Policy>
{
    #[tracing::instrument(skip_all, fields(%team_id, %computer_id), err)]
    async fn brain_health(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> Result<Option<BrainHealth>, TeamAgentError> {
        let Some(computer) = self
            .repo
            .get(computer_id)
            .await
            .map_err(TeamAgentError::internal)?
            .filter(|computer| computer.team_id() == team_id)
        else {
            return Ok(None);
        };
        let computer = computer.into_healthy().map_err(|reason| {
            TeamAgentError::ComputerUnavailable(format!("the computer needs attention: {reason}"))
        })?;
        let (Some(harness_id), Some(persona)) = (computer.harness_id, computer.persona) else {
            return Ok(None);
        };
        let Some(harness) = self
            .harnesses
            .get_harness(harness_id)
            .await
            .map_err(|_| TeamAgentError::internal_message("harness health is unavailable"))?
            .filter(|harness| harness.computer_id == Some(computer_id))
        else {
            return Ok(None);
        };
        let Some(health) = harness.capabilities.personas.get(persona.os_user.as_str()) else {
            return Ok(None);
        };
        let (checked_at, last_turn_at, healthy, last_error) = match health {
            PersonaHealth::Healthy {
                checked_at,
                last_turn_at,
            } => (*checked_at, *last_turn_at, true, None),
            PersonaHealth::Unhealthy {
                checked_at,
                last_turn_at,
                last_error,
            }
            | PersonaHealth::Missing {
                checked_at,
                last_turn_at,
                last_error,
            } => (*checked_at, *last_turn_at, false, Some(last_error.clone())),
        };
        Ok(Some(BrainHealth {
            connected: harness.connected,
            checked_at,
            healthy,
            last_error,
            last_turn_at,
        }))
    }
}

fn computer_status(status: models::ComputerStatus) -> Result<ComputerStatus, TeamAgentError> {
    let payment = status.payment.ok_or_else(|| {
        TeamAgentError::ComputerUnavailable(
            "the computer needs attention: payment state is unavailable".to_owned(),
        )
    })?;
    Ok(ComputerStatus {
        payment: match payment {
            PaymentOutcome::Pending => ComputerPayment::Pending,
            PaymentOutcome::Paid => ComputerPayment::Paid,
            PaymentOutcome::Comped => ComputerPayment::Comped,
            PaymentOutcome::Unbilled => ComputerPayment::Unbilled,
        },
        brain: None,
        status: match status.status {
            models::ComputerStatusKind::SettingUp => ComputerStatusKind::SettingUp,
            models::ComputerStatusKind::Ready => ComputerStatusKind::Ready,
            models::ComputerStatusKind::Asleep => ComputerStatusKind::Asleep,
            models::ComputerStatusKind::Waking | models::ComputerStatusKind::WaitingForCapacity => {
                ComputerStatusKind::Waking
            }
            models::ComputerStatusKind::NeedsAttention => {
                return Err(TeamAgentError::ComputerUnavailable(
                    "the computer needs attention: saved data is invalid".to_owned(),
                ));
            }
            models::ComputerStatusKind::Stopping => ComputerStatusKind::Stopping,
            models::ComputerStatusKind::Stopped => ComputerStatusKind::Stopped,
            models::ComputerStatusKind::Failed | models::ComputerStatusKind::PaymentFailed => {
                ComputerStatusKind::Failed
            }
            models::ComputerStatusKind::Released => ComputerStatusKind::Released,
        },
        setup: status.setup,
    })
}

fn error(source: ComputerError) -> TeamAgentError {
    match source {
        ComputerError::NotFound => TeamAgentError::NotFound,
        ComputerError::BadRequest(message) => TeamAgentError::BadRequest(message),
        ComputerError::NotFailed => TeamAgentError::RetryUnavailable(source.to_string()),
        ComputerError::Billing(BillingError::NoSubscription) => TeamAgentError::NoSubscription,
        ComputerError::SoldOut
        | ComputerError::Billing(BillingError::NotAvailable)
        | ComputerError::Billing(BillingError::IntervalNotSold(_) | BillingError::PaymentFailed) => {
            TeamAgentError::ComputerUnavailable(source.to_string())
        }
        ComputerError::Billing(BillingError::Provider(report)) => {
            TeamAgentError::ComputerProvider(report)
        }
        other => TeamAgentError::internal(other),
    }
}

impl<Repo: ComputerRepo, Bill: Billing, Time: Clock, Harness: HarnessRepo, Policy: CompPolicy>
    HostedRuntimesComputers<Repo, Bill, Time, Harness, Policy>
{
    async fn purchase_with_billing(
        &self,
        purchase: ComputerPurchase,
        billing: models::PurchaseBilling,
    ) -> Result<ComputerId, TeamAgentError> {
        let team_id = purchase.team_id;
        let agent_user_id = purchase.persona.as_ref().and_then(|persona| {
            persona
                .config
                .get(crate::domain::service::config_keys::AGENT_USER_ID)
                .cloned()
        });
        let result = self
            .service
            .purchase(models::PurchaseRequest {
                billing,
                team_id: purchase.team_id,
                created_by: purchase.created_by,
                size: purchase.size,
                name: purchase.name,
                persona: purchase.persona,
                extra_items: purchase
                    .extra_items
                    .into_iter()
                    .map(|item| models::SubscriptionItem {
                        price_id: item.price_id,
                        quantity: item.quantity,
                    })
                    .collect(),
            })
            .await;
        match result {
            Err(source @ (ComputerError::Internal(_) | ComputerError::Billing(_))) => {
                // The durable row and payment effect precede Stripe. A pending
                // payment is replayed by hosted runtimes with its original key;
                // a definite refusal remains visible as PaymentFailed.
                tracing::warn!(error = ?source, %team_id, "recovering saved computer purchase");
                let computer_id = match self.repo.list_for_team(team_id).await {
                    Ok(computers) => computers
                        .into_iter()
                        .filter_map(|record| record.into_healthy().ok())
                        .find(|computer| {
                            computer.team_id == team_id
                                && agent_user_id.as_ref().is_some_and(|agent| {
                                    computer.persona.as_ref().and_then(|persona| {
                                        persona
                                            .config
                                            .get(crate::domain::service::config_keys::AGENT_USER_ID)
                                    }) == Some(agent)
                                })
                        })
                        .map(|computer| computer.id),
                    Err(source) => {
                        tracing::error!(error = ?source, %team_id, "could not recover the saved computer identity");
                        None
                    }
                };
                match computer_id {
                    Some(id) => Ok(id),
                    None if matches!(
                        source,
                        ComputerError::Internal(_)
                            | ComputerError::Billing(BillingError::Provider(_))
                    ) =>
                    {
                        Err(TeamAgentError::ComputerIdentityUnavailable)
                    }
                    None => Err(error(source)),
                }
            }
            other => other.map_err(error),
        }
    }
}

impl<
    Repo: ComputerRepo,
    Bill: Send + Sync + 'static,
    Time: Send + Sync + 'static,
    Harness: Send + Sync + 'static,
    Policy: Send + Sync + 'static,
> crate::domain::enrollment::EnrollmentComputers
    for HostedRuntimesComputers<Repo, Bill, Time, Harness, Policy>
{
    async fn enrollment_computer(
        &self,
        computer: ComputerId,
    ) -> Result<
        models::Computer,
        hosted_runtimes::domain::persona_credentials::PersonaCredentialError,
    > {
        use hosted_runtimes::domain::persona_credentials::PersonaCredentialError;
        self.repo
            .get(computer)
            .await
            .map_err(|_| PersonaCredentialError::IssuanceFailed)?
            .ok_or(PersonaCredentialError::NotFound)?
            .into_healthy()
            .map_err(|_| PersonaCredentialError::IssuanceFailed)
    }
}
