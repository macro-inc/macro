//! Composition helpers shared by the service's binaries: concrete adapters
//! from other crates are built here, never inside an adapter.

use std::sync::Arc;

use attention_feed::outbound::soup::SoupCandidateSource;
use call::domain::service::CallRecordQueryServiceImpl;
use call::outbound::pg_call_repo::PgCallRepo;
use channels::domain::list_service::ChannelListServiceImpl;
use channels::outbound::pg_channels_repo::PgChannelsRepo;
use crm::domain::service::NoOpCrmService;
use email::domain::ports::{NoOpEnqueuer, ReadonlyEmailPreviewAdapter};
use email::domain::service::EmailServiceImpl;
use email::outbound::EmailPgRepo;
use entity_access_management::domain::service::EntityAccessManagementServiceImpl;
use foreign_entity::domain::service::ForeignEntityServiceImpl;
use foreign_entity::outbound::pg_foreign_entity_repo::PgForeignEntityRepo;
use frecency::domain::services::FrecencyQueryServiceImpl;
use frecency::outbound::postgres::FrecencyPgStorage;
use github_pull_requests::domain::service::GithubPullRequestServiceImpl;
use github_pull_requests::outbound::pg_github_pull_request_repo::PgGithubPullRequestRepo;
use readonly_pool::ReadOnlyPool;
use soup::domain::service::SoupImpl;
use soup::outbound::pg_soup_repo::PgSoupRepo;
use sqlx::PgPool;

type Frecency = FrecencyQueryServiceImpl<FrecencyPgStorage>;
type Mail = EmailServiceImpl<
    EmailPgRepo,
    Frecency,
    NoOpEnqueuer,
    NoOpCrmService,
    EntityAccessManagementServiceImpl<entity_access_management::outbound::PgRepository>,
>;
type Soup = SoupImpl<
    PgSoupRepo,
    Frecency,
    ReadonlyEmailPreviewAdapter<Mail>,
    ChannelListServiceImpl<PgChannelsRepo, PgChannelsRepo, FrecencyPgStorage>,
    CallRecordQueryServiceImpl<PgCallRepo>,
    NoOpCrmService,
    GithubPullRequestServiceImpl<
        ForeignEntityServiceImpl<PgForeignEntityRepo>,
        PgGithubPullRequestRepo,
    >,
>;

/// The feeds' candidate source.
pub(crate) type SoupCandidates = SoupCandidateSource<Arc<Soup>, Mail>;

/// Soup's candidate source over `primary`. It must be the primary: a send
/// right after a share or a create would otherwise be refused while a replica
/// catches up.
pub(crate) fn soup_candidates(primary: PgPool) -> SoupCandidates {
    let frecency_storage = FrecencyPgStorage::new(primary.clone());
    let frecency = FrecencyQueryServiceImpl::new(frecency_storage.clone());
    let mail = EmailServiceImpl::new(
        EmailPgRepo::new(primary.clone()),
        frecency.clone(),
        NoOpEnqueuer,
        NoOpCrmService,
        EntityAccessManagementServiceImpl::new(
            entity_access_management::outbound::PgRepository::new(primary.clone()),
        ),
        0,
    );
    let soup = SoupImpl::new(
        PgSoupRepo::new(ReadOnlyPool(primary.clone())),
        frecency,
        ReadonlyEmailPreviewAdapter(mail.clone()),
        ChannelListServiceImpl::new(
            PgChannelsRepo::new(primary.clone()),
            PgChannelsRepo::new(primary.clone()),
            frecency_storage,
        ),
        CallRecordQueryServiceImpl::new(PgCallRepo::new(primary.clone())),
        NoOpCrmService,
        GithubPullRequestServiceImpl::new(
            ForeignEntityServiceImpl::new(PgForeignEntityRepo::new(primary.clone())),
            PgGithubPullRequestRepo::new(primary),
        ),
    );
    SoupCandidateSource::new(Arc::new(soup), Arc::new(mail))
}
