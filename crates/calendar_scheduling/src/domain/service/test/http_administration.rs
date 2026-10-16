//! Real HTTP adapter/router contract with in-memory scheduling persistence.
use super::*;
use crate::{
    domain::{
        administration::SchedulingAdministration, insights::InsightQuery, management::BookingChange,
    },
    inbound::router::{RouterState, router},
    outbound::administration_client::SchedulingAdministrationClient,
};
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use model_user::UserContext;
use rootcause::Report;

#[derive(Clone)]
struct Identity;
impl MacroAuthorizationService for Identity {
    async fn authorize(&self, _: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
    async fn authorize_internal(
        &self,
        key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if key != "test-key" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(claims.user_id.map(|user_id| UserContext {
            user_id,
            ..Default::default()
        }))
    }
}

#[tokio::test]
async fn client_and_router_preserve_authority_and_all_management_workflows() {
    let user = "macro|host@example.com";
    let service = Arc::new(TestService::new(
        Arc::new(Memory::default()),
        Arc::new(Calendar::default()),
        Members,
    ));
    let app = axum::Router::new().nest(
        "/calendar/scheduling",
        router(RouterState::new(
            service.clone(),
            MacroAuthorizationState::new(Arc::new(Identity)),
        )),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/calendar", listener.local_addr().unwrap());
    let server = tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    let client = SchedulingAdministrationClient::new(url.clone(), "test-key".into());
    let initial = client.settings(user, None).await.unwrap();
    assert_eq!(initial.revision, 0);
    let mut wanted = profile(None);
    wanted.id = initial.id;
    wanted.event_types[0].hosts = vec![user.into()];
    let saved = client.save(user, None, wanted.clone()).await.unwrap();
    assert_eq!(saved.revision, 1);
    assert!(matches!(
        client.save(user, None, wanted).await,
        Err(Error::Conflict)
    ));
    let record = service
        .book(saved.id, saved.event_types[0].id, request())
        .await
        .unwrap();
    let date = record.booking.starts_at.date_naive();
    let bookings = client
        .bookings_in_range(user, None, record.booking.starts_at, record.booking.ends_at)
        .await
        .unwrap();
    assert_eq!(bookings.len(), 1);
    let insights = client
        .booking_insights(
            user,
            None,
            InsightQuery {
                from: date,
                to: date,
                time_zone: chrono_tz::UTC,
                event_type_id: None,
                host_id: None,
            },
        )
        .await
        .unwrap();
    assert_eq!(insights.current.counts.total, 1);
    assert_eq!(insights.current.counts.completed, 0);
    let id = record.booking.id;
    assert!(matches!(
        client
            .change_booking("macro|outsider@example.com", id, BookingChange::Cancel)
            .await,
        Err(Error::Forbidden)
    ));
    let slots = client.host_replacement_slots(user, id, date).await.unwrap();
    let next = slots
        .iter()
        .find(|s| s.starts_at != record.booking.starts_at)
        .unwrap();
    let moved = client
        .change_booking(
            user,
            id,
            BookingChange::Reschedule {
                starts_at: next.starts_at,
            },
        )
        .await
        .unwrap();
    assert_eq!(moved.reschedule_count, 1);
    let cancelled = client
        .change_booking(user, id, BookingChange::Cancel)
        .await
        .unwrap();
    assert_eq!(cancelled.status, BookingStatus::Cancelled);
    let unauthenticated = SchedulingAdministrationClient::new(url, "wrong-key".into());
    assert!(matches!(
        unauthenticated.settings(user, None).await,
        Err(Error::Forbidden)
    ));
    server.abort();
}
