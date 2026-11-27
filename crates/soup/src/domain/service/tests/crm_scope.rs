//! CRM-scoped email (`crm_domains` / `crm_addresses`) through the Soup
//! service: which email authorization failures leave the email source out of
//! the page and which still fail the request.
use super::*;

const USER: &str = "macro|test@example.com";
const TEAM: Uuid = Uuid::from_u128(0x7e);
const DOCUMENT: Uuid = Uuid::from_u128(0xd0c);

/// Builds the error a stubbed email service fails with.
pub(crate) type MakeEmailErr = fn() -> EmailErr;

/// Fails every email preview request with the error `make` builds.
pub(crate) struct FailingEmailPreviewService {
    pub(crate) make: MakeEmailErr,
    pub(crate) calls: Arc<Mutex<usize>>,
}

impl EmailPreviewServiceReadOnly for FailingEmailPreviewService {
    async fn get_email_thread_previews(
        &self,
        req: email::domain::models::GetEmailsRequest,
    ) -> Result<PaginatedCursor<EnrichedEmailThreadPreview, Uuid, SimpleSortMethod, ()>, EmailErr>
    {
        assert!(req.crm_scope.is_some(), "the request carries the CRM scope");
        *self.calls.lock().unwrap() += 1;
        Err((self.make)())
    }
}

fn domain_scope() -> item_filters::EmailFilters {
    item_filters::EmailFilters {
        crm_domains: vec!["example.com".to_string()],
        ..item_filters::EmailFilters::default()
    }
}

fn address_scope() -> item_filters::EmailFilters {
    item_filters::EmailFilters {
        crm_addresses: vec!["contact@example.com".to_string()],
        ..item_filters::EmailFilters::default()
    }
}

async fn crm_scoped_soup(
    email_filters: item_filters::EmailFilters,
    make: MakeEmailErr,
) -> (Result<Vec<String>, SoupErr>, usize) {
    let user = MacroUserIdStr::parse_from_str(USER).unwrap();
    let mut soup_mock = MockSoupRepo::new();
    soup_mock
        .expect_unexpanded_generic_cursor_soup()
        .returning(|_params| {
            Box::pin(async move {
                Ok(vec![SoupItem::Document(soup_document_uuid_with_updated(
                    DOCUMENT,
                    Default::default(),
                ))])
            })
        });
    let calls = Arc::new(Mutex::new(0));
    let team_receipt = EntityAccessReceipt::<MemberTeamRole>::dangerously_assert_authenticated_user(
        user.clone(),
        &TEAM.to_string(),
        EntityType::Team,
    );

    let result = SoupImpl::new(
        soup_mock,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        FailingEmailPreviewService {
            make,
            calls: calls.clone(),
        },
        NoopCommsService,
        NoopCallRecordQueryService,
        NoOpCrmService,
        NoopPullRequestListing,
    )
    .get_user_soup(
        SoupRequest {
            sort_direction: SoupSortDirection::default(),
            email_preview_view: PreviewView::StandardLabel(
                email::domain::models::PreviewViewStandardLabel::All,
            ),
            link_ids: vec![Uuid::from_u128(0x11)],
            soup_type: SoupType::UnExpanded,
            limit: 20,
            cursor: SoupQuery::new_sort_simple(
                SimpleSortMethod::UpdatedAt,
                EntityFilters {
                    email_filters,
                    ..EntityFilters::default()
                },
            ),
            user,
        },
        Some(team_receipt),
    )
    .await
    .map(|output| {
        output
            .type_erase()
            .items
            .iter()
            .map(|item| item.entity().entity_id.to_string())
            .collect()
    });
    let calls = *calls.lock().unwrap();
    (result, calls)
}

async fn assert_omits_email_threads(
    email_filters: item_filters::EmailFilters,
    make: MakeEmailErr,
    name: &str,
) {
    let (result, calls) = crm_scoped_soup(email_filters, make).await;

    let ids = result.unwrap_or_else(|err| panic!("{name} is not a server error, got {err:?}"));
    assert_eq!(calls, 1, "{name}");
    assert_eq!(
        ids,
        vec![DOCUMENT.to_string()],
        "{name}: other sources keep their items"
    );
}

#[tokio::test]
async fn unknown_crm_domain_omits_email_threads() {
    assert_omits_email_threads(
        domain_scope(),
        || EmailErr::CrmDomainNotFound("example.com".to_string()),
        "CrmDomainNotFound",
    )
    .await;
}

#[tokio::test]
async fn not_permitted_crm_domain_omits_email_threads() {
    assert_omits_email_threads(
        domain_scope(),
        || EmailErr::CrmDomainNotPermitted("example.com".to_string()),
        "CrmDomainNotPermitted",
    )
    .await;
}

#[tokio::test]
async fn unknown_crm_address_omits_email_threads() {
    assert_omits_email_threads(
        address_scope(),
        || EmailErr::CrmAddressNotFound("contact@example.com".to_string()),
        "CrmAddressNotFound",
    )
    .await;
}

#[tokio::test]
async fn not_permitted_crm_address_omits_email_threads() {
    assert_omits_email_threads(
        address_scope(),
        || EmailErr::CrmAddressNotPermitted("contact@example.com".to_string()),
        "CrmAddressNotPermitted",
    )
    .await;
}

#[tokio::test]
async fn other_email_errors_still_fail_the_request() {
    let cases: [(MakeEmailErr, &str); 3] = [
        (|| EmailErr::CrmDisabledForTeam, "CrmDisabledForTeam"),
        (|| EmailErr::Unauthorized, "Unauthorized"),
        (
            || EmailErr::RepoErr(anyhow::anyhow!("database unavailable")),
            "RepoErr",
        ),
    ];
    for scope in [domain_scope(), address_scope()] {
        for (make, name) in cases {
            let (result, _) = crm_scoped_soup(scope.clone(), make).await;
            let err = result.expect_err(name);
            assert!(
                matches!(err, SoupErr::EmailErr(_)),
                "{name} should stay an email error, got {err:?}"
            );
        }
    }
}
