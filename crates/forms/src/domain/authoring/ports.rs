//! Ports for durable authoring and authorized scheduling selection.
use super::models::Snapshot;
use crate::domain::{
    models::FormError,
    ports::{CreateFormCommand, FormsService},
};
use databases::domain::models::Viewer;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use models_forms::{FormDetail, FormId, FormLayout};

/// Forms' existing source-of-truth operations, with conditional authoring writes.
pub trait AuthoringCore: FormsService {
    /// Describe source schema and predictable managed identities before provisioning.
    fn authoring_source(
        &self,
        source: &crate::domain::ports::CreateSource,
    ) -> impl Future<
        Output = Result<(Vec<super::Column>, Vec<models_databases::ColumnId>), FormError>,
    > + Send;
    /// Publish liveness and attributed sharing events after a committed authoring write.
    fn authoring_changed(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        sharing: bool,
    ) -> impl Future<Output = ()> + Send;
    /// Create closed/private at insertion with a reserved operation identity.
    fn create_private(
        &self,
        creator: Viewer,
        command: CreateFormCommand,
        id: FormId,
    ) -> impl Future<Output = Result<FormDetail, FormError>> + Send;
    /// Read the actual durable draft, never substitute the respondent projection.
    fn authoring_snapshot(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
    ) -> impl Future<Output = Result<Snapshot, FormError>> + Send;
    /// Validate and commit only at the exact Loro version observed by the planner.
    fn save_authoring_layout(
        &self,
        receipt: EntityAccessReceipt<EditAccessLevel>,
        expected_revision: Vec<u8>,
        layout: FormLayout,
    ) -> impl Future<Output = Result<Snapshot, FormError>> + Send;
}

/// Authoritative Forms workflows consumed by tools. Policy and orchestration stay here.
pub trait FormsAuthoringService: Send + Sync + 'static {
    /// Validate and provision a complete closed/private form.
    fn create_form(
        &self,
        actor: Viewer,
        intent: super::Create,
    ) -> impl Future<Output = Result<super::MutationResult, super::AuthoringError>> + Send;
    /// Read editor-only durable state or the respondent-safe projection.
    fn read_form(
        &self,
        actor: Viewer,
        intent: super::Read,
    ) -> impl Future<Output = Result<super::ReadResult, super::AuthoringError>> + Send;
    /// Preserve untouched human edits and refuse changes of the same field.
    fn edit_form(
        &self,
        actor: Viewer,
        intent: super::Edit,
    ) -> impl Future<Output = Result<super::MutationResult, super::AuthoringError>> + Send;
    /// Discover only grant-visible forms using bounded semantic filters.
    fn list_forms(
        &self,
        actor: Viewer,
        intent: super::List,
    ) -> impl Future<Output = Result<super::ListResult, super::AuthoringError>> + Send;
    /// Owner-only exact-review transition with explicit grant deltas.
    fn set_form_access(
        &self,
        actor: Viewer,
        intent: super::SetAccess,
    ) -> impl Future<Output = Result<super::MutationResult, super::AuthoringError>> + Send;
}

/// Receipt acquisition stays behind the owning entity-access capability.
pub trait AuthoringAccess: Send + Sync + 'static {
    /// Prove the minimum grant; callers do not manufacture their own receipts.
    fn receipt<Level: entity_access::domain::models::RequiredPermission>(
        &self,
        actor: &Viewer,
        entity: entity_access::domain::models::Entity,
    ) -> impl Future<Output = Result<EntityAccessReceipt<Level>, super::AuthoringError>> + Send;
}

/// Scheduling validates ownership and readiness of a stable existing target.
pub trait AuthoringBooking: Send + Sync + 'static {
    /// Refuse missing, disabled, unauthorized or unusable booking links.
    fn check_target(
        &self,
        actor: &Viewer,
        target: &models_forms::BookingTarget,
    ) -> impl Future<Output = Result<(), super::AuthoringError>> + Send;
}

/// An unconfigured host refuses booking attachment before writes.
impl AuthoringBooking for () {
    async fn check_target(
        &self,
        _actor: &Viewer,
        _target: &models_forms::BookingTarget,
    ) -> Result<(), super::AuthoringError> {
        Err(super::AuthoringError::new(
            super::Code::BookingTargetUnavailable,
            "booking",
            "Booking target validation is unavailable on this host.",
        ))
    }
}
