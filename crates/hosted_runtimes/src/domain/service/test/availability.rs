use super::*;
use crate::domain::models::FleetAttachment;
use crate::domain::ports::StaticFleetAttachment;

#[tokio::test]
async fn detached_fleet_precedes_missing_rows_and_all_side_effects() {
    let service = ComputerService::new(
        FakeRepo::default(),
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Detached),
    )
    .with_rollout(rollout::enabled_rollout());
    let id = ComputerId::new_from_uuid(Uuid::now_v7());
    assert!(matches!(
        service.status(TEAM, id).await,
        Err(ComputerError::FleetUnavailable(_))
    ));
    assert!(matches!(
        service
            .purchase(PurchaseRequest {
                billing: PurchaseBilling::Stripe,
                purchase_key: key("buy-dialog-1"),
                team_id: TEAM,
                created_by: MacroUserIdStr::try_from("macro|admin@example.com".to_owned()).unwrap(),
                size: ComputerSize::Standard,
                name: None,
                extra_items: vec![],
            })
            .await,
        Err(ComputerError::FleetUnavailable(_))
    ));
    assert!(service.repo.computers.lock().unwrap().is_empty());
    assert!(service.repo.events.lock().unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn detached_catalog_needs_no_prices() {
    let service = ComputerService::new(
        FakeRepo::default(),
        FakeBilling {
            not_sold: true,
            ..FakeBilling::default()
        },
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Detached),
    );
    assert_eq!(service.catalog().len(), 3);
    assert!(service.size_spec(ComputerSize::Standard).is_ok());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

/// Comp policy for exercising the registered HTTP routes.
pub(crate) struct RouterCompPolicy(pub bool);

impl CompPolicy for RouterCompPolicy {
    type Err = std::convert::Infallible;
    async fn comp_reason(&self, _team_id: Uuid) -> Result<Option<String>, Self::Err> {
        Ok(self.0.then(|| "complimentary team".to_owned()))
    }
}

pub(crate) type RouterService = ComputerService<
    FakeRepo,
    FakeBilling,
    FixedClock,
    crate::domain::ports::StaticFleetAttachment,
    RouterCompPolicy,
>;

pub(crate) async fn detached_router_service(
    comped: bool,
    rollout_enabled: bool,
) -> (std::sync::Arc<RouterService>, ComputerId) {
    let repo = FakeRepo {
        sold_units: 9,
        ..FakeRepo::default()
    };
    let id = ComputerId::new_from_uuid(Uuid::now_v7());
    repo.computers.lock().unwrap().insert(
        id,
        super::computer(
            id,
            Phase::Running,
            crate::domain::lifecycle::Billing::Active {
                subscription_item: super::item("si_1"),
            },
        ),
    );
    repo.events.lock().unwrap().clear();
    repo.effects.lock().unwrap().clear();
    let mut service = ComputerService::new(
        repo,
        FakeBilling::default(),
        FixedClock,
        crate::domain::ports::StaticFleetAttachment(
            crate::domain::models::FleetAttachment::Detached,
        ),
    )
    .with_comp_policy(RouterCompPolicy(comped));
    if rollout_enabled {
        service = service.with_rollout(rollout::enabled_rollout());
    }
    (std::sync::Arc::new(service), id)
}

pub(crate) fn assert_no_http_work(service: &RouterService) {
    assert_eq!(service.repo.computers.lock().unwrap().len(), 1);
    assert_eq!(*service.repo.reserve_calls.lock().unwrap(), 0);
    assert_eq!(*service.billing.sales_checks.lock().unwrap(), 0);
    assert!(service.repo.events.lock().unwrap().is_empty());
    assert!(service.repo.effects.lock().unwrap().is_empty());
    assert!(service.billing.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn attachment_gate_checks_presence_without_repository_calls() {
    let mut service = ComputerService::new(
        FakeRepo::default(),
        FakeBilling::default(),
        FixedClock,
        StaticFleetAttachment(FleetAttachment::Detached),
    );

    assert!(matches!(
        service.require_attached().await,
        Err(ComputerError::FleetUnavailable(_))
    ));
    assert_eq!(
        service.repo.calls.load(std::sync::atomic::Ordering::SeqCst),
        0
    );

    service.attachment = StaticFleetAttachment(FleetAttachment::Attached);
    assert!(service.require_attached().await.is_ok());
    assert_eq!(
        service.repo.calls.load(std::sync::atomic::Ordering::SeqCst),
        0
    );
}
