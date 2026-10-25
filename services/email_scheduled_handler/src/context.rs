use crate::outbound::{RecoveryQueue, RecoveryRepository};
use email::domain::scheduled_delivery::recovery::ScheduledRecovery;

#[derive(Clone)]
pub struct Context {
    pub recovery: ScheduledRecovery<RecoveryRepository, RecoveryQueue>,
}
