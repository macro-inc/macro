//! Global rollout for CRM preference writes during membership-writer upgrades.

use feature_flags::{ServiceContext, ServiceFeatureFlags};
use std::{future::Future, pin::Pin};
use teams::domain::{crm_member_access::CrmAccessRollout, model::TeamError};

const FLAG: &str = "enable-crm-member-access-changes";
const CONTEXT: ServiceContext = ServiceContext::new("team-crm-member-access");

/// A fresh global decision for each preference change; reads never use this gate.
pub struct FlaggedCrmAccessRollout<F>(pub F);

impl<F> std::fmt::Debug for FlaggedCrmAccessRollout<F> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FlaggedCrmAccessRollout")
            .finish_non_exhaustive()
    }
}

impl<F: ServiceFeatureFlags + 'static> CrmAccessRollout for FlaggedCrmAccessRollout<F> {
    fn require_enabled(&self) -> Pin<Box<dyn Future<Output = Result<(), TeamError>> + Send + '_>> {
        Box::pin(async {
            let flags = self.0.load_service(CONTEXT).await.map_err(|_| {
                tracing::warn!("CRM access preference rollout evaluation failed");
                TeamError::CrmAccessChangesUnavailable
            })?;
            if flags.is_enabled(FLAG) {
                Ok(())
            } else {
                Err(TeamError::CrmAccessChangesUnavailable)
            }
        })
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use feature_flags::{FlagSnapshot, FlagValue, outbound::fake::FakeFeatureFlags};

    #[tokio::test]
    async fn missing_disabled_or_failed_decisions_refuse_writes() {
        for result in [
            Ok(FlagSnapshot::default()),
            Ok(FlagSnapshot::new([(
                FLAG.into(),
                FlagValue::Boolean(false),
            )])),
            Err("unavailable".into()),
        ] {
            let mut flags = FakeFeatureFlags::default();
            flags.set_service(CONTEXT, result);
            assert!(matches!(
                FlaggedCrmAccessRollout(flags).require_enabled().await,
                Err(TeamError::CrmAccessChangesUnavailable)
            ));
        }
    }

    #[tokio::test]
    async fn explicit_service_rollout_admits_writes() {
        let mut flags = FakeFeatureFlags::default();
        flags.set_service(
            CONTEXT,
            Ok(FlagSnapshot::new([(FLAG.into(), FlagValue::Boolean(true))])),
        );
        FlaggedCrmAccessRollout(flags)
            .require_enabled()
            .await
            .unwrap();
    }
}
