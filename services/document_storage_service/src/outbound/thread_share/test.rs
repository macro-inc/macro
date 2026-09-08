use super::*;
use crate::service::thread_share::ThreadSharePolicyService;
use entity_access::domain::models::{
    EntityAccessAuth, EntityAccessReceipt, EntityPermission, OwnerAccessLevel,
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_permissions::share_permission::{
    LinkShare,
    access_level::AccessLevel,
    team_share::{TeamShareLevel, TeamShareRequest, authorize_team_share},
};

const THREAD: uuid::Uuid = uuid::uuid!("20000000-0000-0000-0000-000000000004");
const OWNER: &str = "macro|owner@example.com";
const OTHER: &str = "macro|other@example.com";

fn receipt(actor: &str) -> EntityAccessReceipt<OwnerAccessLevel> {
    EntityAccessReceipt::try_new(
        EntityAccessAuth::Authenticated(
            MacroUserIdStr::parse_from_str(actor).unwrap().into_owned(),
        ),
        entity_access::domain::models::Entity {
            entity_id: THREAD.to_string(),
            entity_type: EntityType::EmailThread,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Owner,
        },
    )
    .unwrap()
}

async fn setup(db: &PgPool) {
    sqlx::raw_sql(include_str!(
        "../../../../../crates/share_permission_db_utils/fixtures/team_share.sql"
    ))
    .execute(db)
    .await
    .unwrap();
}

async fn counts(db: &PgPool) -> (i64, i64, i64) {
    let row = sqlx::query!(
        r#"SELECT
        (SELECT count(*) FROM "SharePermission") AS "permissions!",
        (SELECT count(*) FROM "EmailThreadPermission") AS "associations!",
        (SELECT count(*) FROM entity_access WHERE entity_id = $1) AS "grants!""#,
        THREAD
    )
    .fetch_one(db)
    .await
    .unwrap();
    (row.permissions, row.associations, row.grants)
}

fn request(level: Option<Option<AccessLevel>>) -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        team_share_access_level: level,
        link_share: None,
        link_share_access_level: None,
        channel_share_permissions: None,
    }
}

struct ShareMutation;

#[async_graphql::Object]
impl ShareMutation {
    async fn share(
        &self,
        ctx: &async_graphql::Context<'_>,
        input: complete_graph::EntitySharePolicyInput,
    ) -> async_graphql::Result<bool> {
        let policy = input.into_model();
        let mut entity = receipt(OWNER).entity().clone();
        entity.entity_id = GRAPHQL_THREAD.to_string();
        let receipt = EntityAccessReceipt::try_new(
            receipt(OWNER).auth().clone(),
            entity,
            EntityPermission::AccessLevel {
                access_level: AccessLevel::Owner,
            },
        )
        .unwrap();
        ctx.data_unchecked::<ThreadSharePolicyService<PgThreadShareRepository>>()
            .update_share_policy(receipt, policy)
            .await
            .map_err(|error| async_graphql::Error::new(error.to_string()))?;
        Ok(true)
    }
}

struct Query;

#[async_graphql::Object]
impl Query {
    async fn ready(&self) -> bool {
        true
    }
}

const GRAPHQL_THREAD: uuid::Uuid = uuid::uuid!("20000000-0000-0000-0000-000000000014");

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn rest_and_graphql_inputs_produce_identical_canonical_state(db: PgPool) {
    setup(&db).await;
    sqlx::query!(
        "INSERT INTO email_threads (id, link_id) SELECT $1, link_id FROM email_threads WHERE id = $2",
        GRAPHQL_THREAD,
        THREAD,
    )
    .execute(&db)
    .await
    .unwrap();
    let service = ThreadSharePolicyService::new(PgThreadShareRepository::new(db.clone()));
    let schema =
        async_graphql::Schema::build(Query, ShareMutation, async_graphql::EmptySubscription)
            .data(ThreadSharePolicyService::new(PgThreadShareRepository::new(
                db.clone(),
            )))
            .finish();
    let repo = PgThreadShareRepository::new(db.clone());
    for (rest, graphql, revision) in [
        ("{}", "{}", 0),
        (
            r#"{"teamShareAccessLevel":"edit"}"#,
            "{teamShareAccessLevel: EDIT}",
            1,
        ),
        (
            r#"{"teamShareAccessLevel":"comment"}"#,
            "{teamShareAccessLevel: COMMENT}",
            2,
        ),
        (
            r#"{"teamShareAccessLevel":"view"}"#,
            "{teamShareAccessLevel: VIEW}",
            3,
        ),
        (
            r#"{"teamShareAccessLevel":"view"}"#,
            "{teamShareAccessLevel: VIEW}",
            4,
        ),
        ("{}", "{}", 4),
        (
            r#"{"teamShareAccessLevel":null}"#,
            "{teamShareAccessLevel: null}",
            5,
        ),
        (
            r#"{"teamShareAccessLevel":null}"#,
            "{teamShareAccessLevel: null}",
            6,
        ),
    ] {
        let request: UpdateSharePermissionRequestV2 = serde_json::from_str(rest).unwrap();
        service
            .update_share_policy(receipt(OWNER), request)
            .await
            .unwrap();
        let response = schema
            .execute(format!("mutation {{ share(input: {graphql}) }}"))
            .await;
        assert!(response.errors.is_empty(), "{:?}", response.errors);
        let rest = repo.owner_facts(THREAD).await.unwrap();
        let graphql = repo.owner_facts(GRAPHQL_THREAD).await.unwrap();
        assert_eq!(rest.revision, revision);
        assert_eq!(
            (rest.owner, rest.owner_team_id, rest.current, rest.revision),
            (
                graphql.owner,
                graphql.owner_team_id,
                graphql.current,
                graphql.revision
            )
        );
        let grants = sqlx::query!(
            "SELECT entity_id, source_type::text AS source_type, source_id, access_level::text AS level FROM entity_access WHERE entity_id = ANY($1) ORDER BY source_type, source_id",
            &[THREAD, GRAPHQL_THREAD],
        )
        .fetch_all(&db)
        .await
        .unwrap();
        let levels = |id| {
            grants
                .iter()
                .filter(|row| row.entity_id == id)
                .map(|row| (&row.source_type, &row.source_id, &row.level))
                .collect::<Vec<_>>()
        };
        assert_eq!(levels(THREAD), levels(GRAPHQL_THREAD));
    }
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn denied_first_share_creates_nothing(db: PgPool) {
    setup(&db).await;
    let before = counts(&db).await;
    let service = ThreadSharePolicyService::new(PgThreadShareRepository::new(db.clone()));
    for level in [Some(None), Some(Some(AccessLevel::View))] {
        assert!(matches!(
            service
                .update_share_policy(receipt(OTHER), request(level))
                .await,
            Err(ThreadShareError::Policy(_))
        ));
        assert_eq!(counts(&db).await, before);
    }
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn stale_owner_command_is_rejected_before_lazy_creation(db: PgPool) {
    setup(&db).await;
    let before = counts(&db).await;
    let repository = PgThreadShareRepository::new(db.clone());
    let facts = repository.owner_facts(THREAD).await.unwrap();
    let command = authorize_team_share(
        Some(&facts.owner),
        &facts,
        TeamShareRequest {
            access_level: Some(None),
            legacy_enabled: None,
        },
        TeamShareLevel::View,
    )
    .unwrap()
    .unwrap();
    let mut transaction = db.begin().await.unwrap();
    team_share::acquire_guard(&mut transaction).await.unwrap();
    sqlx::query!(
        "UPDATE email_links SET macro_id = $1 WHERE id = (SELECT link_id FROM email_threads WHERE id = $2)",
        OTHER,
        THREAD,
    ).execute(transaction.as_mut()).await.unwrap();
    transaction.commit().await.unwrap();
    assert!(matches!(
        repository
            .persist(THREAD, request(Some(None)), Some(command))
            .await,
        Err(ThreadShareError::Conflict)
    ));
    assert_eq!(counts(&db).await, before);
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn stale_permission_owner_does_not_authorize_team_sharing(db: PgPool) {
    setup(&db).await;
    let service = ThreadSharePolicyService::new(PgThreadShareRepository::new(db.clone()));
    service
        .update_share_policy(receipt(OWNER), request(None))
        .await
        .unwrap();
    sqlx::query!(
        r#"UPDATE "EmailThreadPermission" SET "userId" = $1 WHERE "threadId" = $2"#,
        OTHER,
        THREAD.to_string()
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        service
            .update_share_policy(receipt(OTHER), request(Some(None)))
            .await,
        Err(ThreadShareError::Policy(_))
    ));
    service
        .update_share_policy(receipt(OWNER), request(Some(Some(AccessLevel::Comment))))
        .await
        .unwrap();
    let facts = PgThreadShareRepository::new(db)
        .owner_facts(THREAD)
        .await
        .unwrap();
    assert_eq!(facts.owner.as_ref(), OWNER);
    assert_eq!(facts.current.unwrap().level, TeamShareLevel::Comment);
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn concurrent_first_shares_leave_one_permission_and_owner_grant(db: PgPool) {
    setup(&db).await;
    let before = counts(&db).await;
    let repository = PgThreadShareRepository::new(db.clone());
    let facts = repository.owner_facts(THREAD).await.unwrap();
    let command = authorize_team_share(
        Some(&facts.owner),
        &facts,
        TeamShareRequest {
            access_level: Some(Some(AccessLevel::View)),
            legacy_enabled: None,
        },
        TeamShareLevel::View,
    )
    .unwrap()
    .unwrap();
    // Both writers authorized against the same absence/revision; the guarded recheck
    // permits only one, and the losing transaction must not leave lazy rows behind.
    let (first, second) = tokio::join!(
        repository.persist(
            THREAD,
            request(Some(Some(AccessLevel::View))),
            Some(command.clone())
        ),
        repository.persist(
            THREAD,
            request(Some(Some(AccessLevel::View))),
            Some(command)
        ),
    );
    assert!(matches!(
        (&first, &second),
        (Ok(()), Err(ThreadShareError::Conflict)) | (Err(ThreadShareError::Conflict), Ok(()))
    ));
    assert_eq!(counts(&db).await, (before.0 + 1, 1, 2));
    assert_eq!(repository.owner_facts(THREAD).await.unwrap().revision, 1);
}

#[sqlx::test(migrations = "../../crates/macro_db_client/migrations")]
async fn failed_accompanying_channel_write_rolls_back_lazy_creation_and_team_grant(db: PgPool) {
    use models_permissions::share_permission::channel_share_permission::{
        UpdateChannelSharePermission, UpdateOperation,
    };
    setup(&db).await;
    let before = counts(&db).await;
    let service = ThreadSharePolicyService::new(PgThreadShareRepository::new(db.clone()));
    sqlx::raw_sql(
        r#"
        CREATE FUNCTION reject_channel_share() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'injected channel write failure'; END $$;
        CREATE TRIGGER reject_channel_share BEFORE INSERT ON "ChannelSharePermission"
        FOR EACH ROW EXECUTE FUNCTION reject_channel_share();
    "#,
    )
    .execute(&db)
    .await
    .unwrap();
    let mut policy = request(Some(Some(AccessLevel::Edit)));
    policy.link_share = Some(Some(LinkShare::Public));
    policy.channel_share_permissions = Some(vec![UpdateChannelSharePermission {
        channel_id: uuid::Uuid::nil().to_string(),
        access_level: Some(AccessLevel::View),
        operation: UpdateOperation::Add,
    }]);
    assert!(
        service
            .update_share_policy(receipt(OWNER), policy)
            .await
            .is_err()
    );
    assert_eq!(counts(&db).await, before);
}
