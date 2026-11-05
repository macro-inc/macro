//! In-process computer purchases through the hosted runtimes domain service.

use std::sync::Arc;

use hosted_runtimes::domain::{
    enrollment, models,
    ports::{Billing, BillingError, ComputerRepo},
    service::{Clock, ComputerError, ComputerService},
    size,
};
use uuid::Uuid;

use crate::domain::models::{
    BillingInterval, ComputerPurchase, ComputerQuote, ComputerSize, ComputerStatus,
    ComputerStatusKind, SetupProgress, SetupStep, TeamAgentError,
};
use crate::domain::ports::Computers;

#[cfg(test)]
mod test;

/// Buys and manages computers using the same service as the team computers API.
pub struct HostedRuntimesComputers<Repo, Bill, Time> {
    service: Arc<ComputerService<Repo, Bill, Time>>,
}

impl<Repo, Bill, Time> HostedRuntimesComputers<Repo, Bill, Time> {
    /// Shares the computer service built by the authentication service.
    pub fn new(service: Arc<ComputerService<Repo, Bill, Time>>) -> Self {
        Self { service }
    }
}

impl<Repo: ComputerRepo, Bill: Billing, Time: Clock> Computers
    for HostedRuntimesComputers<Repo, Bill, Time>
{
    #[tracing::instrument(skip_all, fields(%team_id, ?size), err)]
    async fn quote(
        &self,
        team_id: Uuid,
        size: ComputerSize,
    ) -> Result<ComputerQuote, TeamAgentError> {
        let quote = self
            .service
            .quote(team_id, computer_size(size))
            .await
            .map_err(error)?;
        let size = quote.size;
        Ok(ComputerQuote {
            vcpus: size.vcpus(),
            memory_gb: size.memory_gb(),
            disk_gb: size.disk_gb(),
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
    async fn purchase(&self, purchase: ComputerPurchase) -> Result<Uuid, TeamAgentError> {
        self.service
            .purchase(models::PurchaseRequest {
                team_id: purchase.team_id,
                created_by: purchase.created_by,
                size: computer_size(purchase.size),
                name: purchase.name,
                persona: purchase.persona.map(|persona| enrollment::Persona {
                    name: persona.name,
                    os_user: persona.os_user,
                    extra_service: enrollment::PersonaService {
                        unit_name: persona.extra_service.unit_name,
                        exec: persona.extra_service.exec,
                        env: persona.extra_service.env,
                    },
                    config: persona.config,
                }),
                extra_items: purchase
                    .extra_items
                    .into_iter()
                    .map(|item| models::SubscriptionItem {
                        price_id: item.price_id,
                        quantity: item.quantity,
                    })
                    .collect(),
            })
            .await
            .map_err(error)
    }

    #[tracing::instrument(skip_all, fields(%team_id, %computer_id), err)]
    async fn status(
        &self,
        team_id: Uuid,
        computer_id: Uuid,
    ) -> Result<ComputerStatus, TeamAgentError> {
        let status = self
            .service
            .status(team_id, computer_id)
            .await
            .map_err(error)?;
        Ok(ComputerStatus {
            status: match status.status {
                models::ComputerStatusKind::SettingUp => ComputerStatusKind::SettingUp,
                models::ComputerStatusKind::Ready => ComputerStatusKind::Ready,
                models::ComputerStatusKind::Asleep => ComputerStatusKind::Asleep,
                models::ComputerStatusKind::Waking => ComputerStatusKind::Waking,
                models::ComputerStatusKind::Stopping => ComputerStatusKind::Stopping,
                models::ComputerStatusKind::Stopped => ComputerStatusKind::Stopped,
                models::ComputerStatusKind::Failed => ComputerStatusKind::Failed,
                models::ComputerStatusKind::Released => ComputerStatusKind::Released,
            },
            setup: status.setup.map(|setup| SetupProgress {
                step: match setup.step {
                    models::SetupStep::Paying => SetupStep::Paying,
                    models::SetupStep::Creating => SetupStep::Creating,
                    models::SetupStep::Booting => SetupStep::Booting,
                    models::SetupStep::Connecting => SetupStep::Connecting,
                    models::SetupStep::Ready => SetupStep::Ready,
                },
                position: setup.position,
                total: setup.total,
            }),
        })
    }

    #[tracing::instrument(skip_all, fields(%team_id, %computer_id), err)]
    async fn release(&self, team_id: Uuid, computer_id: Uuid) -> Result<(), TeamAgentError> {
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
            .release_now(team_id, computer_id, &status.name)
            .await
        {
            Ok(_) | Err(ComputerError::NotFound) => Ok(()),
            Err(source) => Err(error(source)),
        }
    }
}

fn computer_size(size: ComputerSize) -> size::ComputerSize {
    match size {
        ComputerSize::Standard => size::ComputerSize::Standard,
        ComputerSize::Large => size::ComputerSize::Large,
        ComputerSize::Xl => size::ComputerSize::Xl,
    }
}

fn error(source: ComputerError) -> TeamAgentError {
    match source {
        ComputerError::NotFound => TeamAgentError::NotFound,
        ComputerError::BadRequest(message) => TeamAgentError::BadRequest(message),
        ComputerError::SoldOut
        | ComputerError::Billing(
            BillingError::NoSubscription
            | BillingError::IntervalNotSold(_)
            | BillingError::PaymentFailed,
        ) => TeamAgentError::ComputerUnavailable(source.to_string()),
        other => TeamAgentError::internal(other),
    }
}
