use super::*;
use crate::domain::models::Backfill;
use axum::body::Body;
use macro_user_id::user_id::MacroUserIdStr;
use tower::ServiceExt;

/// Accepts exactly one body.
struct Receiver;

#[async_trait::async_trait]
impl SyncService for Receiver {
    async fn status(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> crate::domain::ports::Result<SyncStatus> {
        unreachable!()
    }
    async fn connect(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Backfill,
    ) -> crate::domain::ports::Result<String> {
        unreachable!()
    }
    async fn complete(
        &self,
        _: &MacroUserIdStr<'static>,
    ) -> crate::domain::ports::Result<SyncStatus> {
        unreachable!()
    }
    async fn disconnect(&self, _: &MacroUserIdStr<'static>) -> crate::domain::ports::Result<()> {
        unreachable!()
    }
    async fn receive(&self, _: Uuid, body: &[u8]) -> Result<(), SyncError> {
        if body == b"signed" {
            Ok(())
        } else {
            Err(SyncError::InvalidDelivery)
        }
    }
    async fn tick(&self) -> crate::domain::ports::Result<bool> {
        unreachable!()
    }
    async fn reconcile(&self) -> crate::domain::ports::Result<()> {
        unreachable!()
    }
}

async fn post(service: Option<Arc<dyn SyncService>>, body: &'static str) -> StatusCode {
    let router: Router = webhook_router(service);
    router
        .oneshot(
            axum::http::Request::post(format!(
                "/integrations/dialpad/webhooks/{}",
                Uuid::from_u128(1)
            ))
            .header("content-type", "application/jwt")
            .body(Body::from(body))
            .unwrap(),
        )
        .await
        .unwrap()
        .status()
}

#[tokio::test]
async fn deliveries_are_acknowledged_rejected_or_deferred() {
    let service: Arc<dyn SyncService> = Arc::new(Receiver);
    assert_eq!(
        post(Some(service.clone()), "signed").await,
        StatusCode::NO_CONTENT
    );
    assert_eq!(
        post(Some(service), "forged").await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(post(None, "signed").await, StatusCode::SERVICE_UNAVAILABLE);
}
