//! The agent's access-request tools over the real workflow: a request waits on
//! the owner, and the write that needed it works only after the owner grants it.
use access_requests::{
    domain::{models::*, ports::SystemClock, service::AccessRequestService},
    inbound::toolset::{
        AccessRequestToolContext, ReadEntityAccessRequest, RequestEntityAccess,
        RequestableEntityType, RequestedAccess,
    },
    outbound::postgres::PgRequestRepository,
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
use entity_access::{
    domain::{
        models::{EditAccessLevel, EntityType},
        ports::EntityAccessService,
        service::EntityAccessServiceImpl,
    },
    outbound::PgAccessRepository,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use models_permissions::share_permission::access_level::AccessLevel;
use sqlx::PgPool;
use std::sync::Arc;
use uuid::Uuid;

type Access = EntityAccessServiceImpl<PgAccessRepository>;
type Context = AccessRequestToolContext<PgRequestRepository, Access, SystemClock>;

fn user(name: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(format!("macro|{name}@requests.test")).unwrap()
}
const DOCUMENT: Uuid = Uuid::from_u128(16);

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn viewer_requests_edit_waits_for_the_owner_then_retries(pool: PgPool) {
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let service = Arc::new(AccessRequestService::new(
        Arc::new(PgRequestRepository::new(pool.clone())),
        access.clone(),
        SystemClock,
    ));
    let context = || {
        ServiceContext(Context {
            service: service.clone(),
        })
    };
    let read = || ReadEntityAccessRequest {
        entity_type: RequestableEntityType::Document,
        entity_id: DOCUMENT,
    };
    assert!(!reader_can_edit(&access).await, "the reader can only view");

    let requested = RequestEntityAccess {
        entity_type: RequestableEntityType::Document,
        entity_id: DOCUMENT,
        access: RequestedAccess::Edit,
    }
    .call(context(), RequestContext::new(user("reader")))
    .await
    .unwrap();
    assert_eq!(requested.status, RequestStatus::Pending);
    assert_eq!(requested.requested_level, AccessLevel::Edit);
    assert_eq!(requested.sent_to, vec!["macro|owner@requests.test"]);

    let pending = read()
        .call(context(), RequestContext::new(user("reader")))
        .await
        .unwrap();
    assert_eq!(pending.current_access, Some(AccessLevel::View));
    let mine = pending.request.unwrap();
    assert_eq!(mine.status, RequestStatus::Pending);
    assert_eq!(mine.granted_level, None);
    assert!(
        !reader_can_edit(&access).await,
        "a pending request grants nothing"
    );

    let owner = service.state(user("owner"), entity(), 0).await.unwrap();
    let [request] = owner.requests.as_slice() else {
        panic!("the owner sees one request, got {}", owner.requests.len());
    };
    assert_eq!(request.requester_id, user("reader"));
    service
        .resolve(
            user("owner"),
            entity(),
            request.id,
            ResolveRequest {
                revision: request.revision,
                granted_level: Some(AccessLevel::Edit),
            },
        )
        .await
        .unwrap();

    let granted = read()
        .call(context(), RequestContext::new(user("reader")))
        .await
        .unwrap();
    assert_eq!(granted.current_access, Some(AccessLevel::Edit));
    assert_eq!(granted.request.unwrap().status, RequestStatus::Granted);
    assert!(
        reader_can_edit(&access).await,
        "the retried write is allowed"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn the_agent_cannot_raise_access_without_review(pool: PgPool) {
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let service = Arc::new(AccessRequestService::new(
        Arc::new(PgRequestRepository::new(pool.clone())),
        access,
        SystemClock,
    ));
    let context = || {
        ServiceContext(Context {
            service: service.clone(),
        })
    };
    let ask = async |who: &str, level| {
        RequestEntityAccess {
            entity_type: RequestableEntityType::Document,
            entity_id: DOCUMENT,
            access: level,
        }
        .call(context(), RequestContext::new(user(who)))
        .await
    };

    let owner = ask("owner", RequestedAccess::Edit).await.unwrap_err();
    assert!(owner.description.contains("already owns or reviews"));
    let lower = ask("reader", RequestedAccess::View).await.unwrap_err();
    assert!(lower.description.contains("not above"));

    ask("reader", RequestedAccess::Comment).await.unwrap();
    let replay = ask("reader", RequestedAccess::Comment).await.unwrap();
    assert_eq!(
        replay.status,
        RequestStatus::Pending,
        "a replay is harmless"
    );
    let changed = ask("reader", RequestedAccess::Edit).await.unwrap_err();
    assert!(
        changed
            .description
            .contains("You can request access again after"),
        "{}",
        changed.description
    );

    let outsider = ask("outsider", RequestedAccess::View).await.unwrap();
    assert!(outsider.sent_to.is_empty(), "the owner stays private");
    assert_eq!(
        service
            .state(user("reader"), entity(), 0)
            .await
            .unwrap()
            .access_level,
        Some(AccessLevel::View)
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS", fixtures("document"))]
async fn a_new_request_supersedes_a_resolved_one_without_a_revision(pool: PgPool) {
    let access = Arc::new(EntityAccessServiceImpl::new(PgAccessRepository::new(
        pool.clone(),
    )));
    let service = AccessRequestService::new(
        Arc::new(PgRequestRepository::new(pool)),
        access,
        SystemClock,
    );
    let first = service
        .request(user("reader"), entity(), AccessLevel::Comment)
        .await
        .unwrap()
        .request;
    let granted = service
        .resolve(
            user("owner"),
            entity(),
            first.id,
            ResolveRequest {
                revision: first.revision,
                granted_level: Some(AccessLevel::Comment),
            },
        )
        .await
        .unwrap();
    let second = service
        .request(user("reader"), entity(), AccessLevel::Edit)
        .await
        .unwrap()
        .request;
    assert_eq!(second.id, first.id);
    assert_eq!(second.revision, granted.revision + 1);
    assert_eq!(second.status, RequestStatus::Pending);
}

/// The edit receipt every document write is gated on.
async fn reader_can_edit(access: &Access) -> bool {
    access
        .generate_entity_access_receipt::<EditAccessLevel>(
            &user("reader"),
            None,
            &DOCUMENT.to_string(),
            EntityType::Document,
        )
        .await
        .is_ok()
}

fn entity() -> ShareEntity {
    ShareEntity {
        entity_type: ShareEntityType::Document,
        entity_id: DOCUMENT,
    }
}
