//! CRM associations through the Soup service: authorization, the resolved
//! source constraints, and the cursor contract.
use super::*;
use crate::domain::models::CrmPropertyEdge;
use channels::domain::models::{
    MessageParent, ReferenceSource, ReferenceTarget, ReferencingMessage,
};
use crm::domain::{
    association::{CrmAssociation, CrmRecordAssociation},
    auth::{CrmCompanyReceipt, CrmContactReceipt, CrmTeamReceipt},
    companies_repo::{CrmCompanyListSort, CrmCompanySoupCursor},
    model::{
        CrmCompanyForSoup, CrmCompanyWithContacts, CrmContact, CrmError, CrmScopePrecheck,
        CrmTeamSettings, CrmTeamSettingsPatch, DepopulateContactOutcome,
    },
};
use entity_access::domain::models::{EditAccessLevel, ViewAccessLevel};
use item_filters::ast::{crm_association::CrmAssociation as Record, document::DocumentLiteral};
use models_properties::EntityType as PropertyEntityType;

const USER: &str = "macro|test@example.com";
const COMPANY: Uuid = Uuid::from_u128(0xc0);
const CONTACT: Uuid = Uuid::from_u128(0xc1);
const SIBLING_CONTACT: Uuid = Uuid::from_u128(0xc2);
const CHANNEL: Uuid = Uuid::from_u128(0xc4a);

/// Resolves the company to its two contacts; any other record is not visible.
#[derive(Clone)]
struct FakeCrm;

impl CrmService for FakeCrm {
    async fn resolve_association(
        &self,
        user_id: &str,
        _access: Option<&CrmTeamReceipt<MemberTeamRole>>,
        record: CrmAssociation,
    ) -> Result<CrmRecordAssociation, CrmError> {
        assert_eq!(user_id, USER);
        match record {
            CrmAssociation::Company(COMPANY) => Ok(CrmRecordAssociation::company(
                COMPANY,
                vec![CONTACT, SIBLING_CONTACT],
            )),
            CrmAssociation::Contact(CONTACT) => Ok(CrmRecordAssociation::contact(CONTACT)),
            CrmAssociation::Activity => Ok(CrmRecordAssociation::default()),
            CrmAssociation::Company(_) => Err(CrmError::CompanyNotFoundForTeam),
            CrmAssociation::Contact(_) => Err(CrmError::ContactNotFoundForTeam),
        }
    }

    async fn list_contacts_for_soup(
        &self,
        _user_id: &str,
        _access: Option<&CrmTeamReceipt<MemberTeamRole>>,
        _query: crm::domain::contact_listing::CrmContactListQuery,
    ) -> Result<Vec<crm::domain::contact_listing::CrmContactForSoup>, CrmError> {
        unimplemented!("FakeCrm.list_contacts_for_soup")
    }

    async fn populate_contact(
        &self,
        _team_id: &uuid::Uuid,
        _link_id: &uuid::Uuid,
        _user_email: &str,
        _email: &str,
        _name: Option<&str>,
        _first_at: DateTime<Utc>,
        _last_at: DateTime<Utc>,
        _is_sent: bool,
    ) -> Result<(), CrmError> {
        unimplemented!("FakeCrm.populate_contact")
    }

    async fn depopulate_contact(
        &self,
        _team_id: &uuid::Uuid,
        _link_id: &uuid::Uuid,
        _email: &str,
    ) -> Result<DepopulateContactOutcome, CrmError> {
        unimplemented!("FakeCrm.depopulate_contact")
    }

    async fn link_contact_pairs_with_sources(
        &self,
        _pairs: &[(uuid::Uuid, String)],
    ) -> Result<Vec<(uuid::Uuid, String)>, CrmError> {
        unimplemented!("FakeCrm.link_contact_pairs_with_sources")
    }

    async fn depopulate_link_in_team(
        &self,
        _team_id: &uuid::Uuid,
        _link_id: &uuid::Uuid,
    ) -> Result<(), CrmError> {
        unimplemented!("FakeCrm.depopulate_link_in_team")
    }

    async fn get_team_id_for_user(&self, _macro_id: &str) -> Result<Option<uuid::Uuid>, CrmError> {
        unimplemented!("FakeCrm.get_team_id_for_user")
    }

    async fn create_company(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _name: &str,
        _domain: &str,
    ) -> Result<CrmCompanyWithContacts, CrmError> {
        unimplemented!("FakeCrm.create_company")
    }

    async fn create_contact(
        &self,
        _access: &CrmCompanyReceipt<ViewAccessLevel>,
        _name: &str,
        _email: &str,
    ) -> Result<CrmContact, CrmError> {
        unimplemented!("FakeCrm.create_contact")
    }

    async fn set_email_sync(
        &self,
        _access: &CrmCompanyReceipt<EditAccessLevel>,
        _email_sync: bool,
    ) -> Result<(), CrmError> {
        unimplemented!("FakeCrm.set_email_sync")
    }

    async fn set_company_hidden(
        &self,
        _access: &CrmCompanyReceipt<EditAccessLevel>,
        _hidden: bool,
    ) -> Result<(), CrmError> {
        unimplemented!("FakeCrm.set_company_hidden")
    }

    async fn set_company_name(
        &self,
        _access: &CrmCompanyReceipt<ViewAccessLevel>,
        _name: &str,
    ) -> Result<(), CrmError> {
        unimplemented!("FakeCrm.set_company_name")
    }

    async fn set_contact_hidden(
        &self,
        _access: &CrmContactReceipt<EditAccessLevel>,
        _hidden: bool,
    ) -> Result<(), CrmError> {
        unimplemented!("FakeCrm.set_contact_hidden")
    }

    async fn set_contact_name(
        &self,
        _access: &CrmContactReceipt<ViewAccessLevel>,
        _name: &str,
    ) -> Result<(), CrmError> {
        unimplemented!("FakeCrm.set_contact_name")
    }

    async fn crm_scope_precheck(
        &self,
        _team_id: &uuid::Uuid,
        _domains: &[String],
        _addresses: &[String],
    ) -> Result<CrmScopePrecheck, CrmError> {
        unimplemented!("FakeCrm.crm_scope_precheck")
    }

    async fn list_companies_for_soup(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _user_id: &str,
        _company_ids: &[uuid::Uuid],
        _hidden: Option<bool>,
        _sort: CrmCompanyListSort,
        _cursor: Option<CrmCompanySoupCursor>,
        _limit: i64,
    ) -> Result<Vec<CrmCompanyForSoup>, CrmError> {
        unimplemented!("FakeCrm.list_companies_for_soup")
    }

    async fn list_contacts_for_company(
        &self,
        _access: &CrmCompanyReceipt<ViewAccessLevel>,
    ) -> Result<Vec<CrmContact>, CrmError> {
        unimplemented!("FakeCrm.list_contacts_for_company")
    }

    async fn get_contact_for_team(
        &self,
        _access: &CrmContactReceipt<ViewAccessLevel>,
    ) -> Result<Option<CrmContact>, CrmError> {
        unimplemented!("FakeCrm.get_contact_for_team")
    }

    async fn search_contacts(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _query: &str,
        _limit: u16,
    ) -> Result<Vec<CrmContact>, CrmError> {
        unimplemented!("FakeCrm.search_contacts")
    }

    async fn get_contact_by_email(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _email: &str,
    ) -> Result<Option<CrmContact>, CrmError> {
        unimplemented!("FakeCrm.get_contact_by_email")
    }

    async fn get_company_for_team(
        &self,
        _access: &CrmCompanyReceipt<ViewAccessLevel>,
    ) -> Result<Option<CrmCompanyWithContacts>, CrmError> {
        unimplemented!("FakeCrm.get_company_for_team")
    }

    async fn get_team_settings(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
    ) -> Result<CrmTeamSettings, CrmError> {
        unimplemented!("FakeCrm.get_team_settings")
    }

    async fn update_team_settings(
        &self,
        _access: &CrmTeamReceipt<MemberTeamRole>,
        _patch: CrmTeamSettingsPatch,
    ) -> Result<CrmTeamSettings, CrmError> {
        unimplemented!("FakeCrm.update_team_settings")
    }
}

/// Reference edges keyed by target: a document mentioning the sibling
/// contact, a channel reply mentioning the contact, and a document
/// mentioning the company.
#[derive(Clone, Default)]
struct ReferencingComms {
    targets: Arc<Mutex<Vec<Vec<ReferenceTarget>>>>,
    thread_filters: Arc<Mutex<Vec<String>>>,
}

impl ChannelListService for ReferencingComms {
    async fn get_channels(
        &self,
        _req: GetChannelsRequest,
    ) -> Result<Vec<channels::domain::models::ChannelWithLatest>, Report> {
        Ok(Vec::new())
    }

    async fn get_activities(
        &self,
        _user: MacroUserIdStr<'_>,
    ) -> Result<Vec<channels::domain::models::Activity>, Report> {
        Ok(Vec::new())
    }

    async fn get_thread_messages(
        &self,
        req: GetThreadReplyRowsRequest,
    ) -> Result<Vec<ChannelMessage>, Report> {
        self.thread_filters
            .lock()
            .unwrap()
            .push(serde_json::to_string(req.query.filter()).unwrap());
        Ok(Vec::new())
    }

    async fn get_reference_sources(
        &self,
        targets: &[ReferenceTarget],
    ) -> Result<Vec<ReferenceSource>, Report> {
        self.targets.lock().unwrap().push(targets.to_vec());
        Ok(targets
            .iter()
            .flat_map(
                |target| match (target.entity_type.as_str(), target.entity_id.as_str()) {
                    ("crm_company", id) if id == COMPANY.to_string() => {
                        vec![ReferenceSource::Document(Uuid::from_u128(1).to_string())]
                    }
                    ("crm_contact", id) if id == CONTACT.to_string() => {
                        vec![ReferenceSource::Message(ReferencingMessage {
                            message_id: Uuid::from_u128(0x51),
                            thread_id: Some(Uuid::from_u128(0x50)),
                            parent: MessageParent::Channel(CHANNEL),
                        })]
                    }
                    ("crm_contact", id) if id == SIBLING_CONTACT.to_string() => {
                        vec![ReferenceSource::Document(Uuid::from_u128(2).to_string())]
                    }
                    _ => Vec::new(),
                },
            )
            .collect())
    }

    async fn get_names(
        &self,
        _names: std::collections::HashSet<MacroUserIdStr<'_>>,
    ) -> Result<Vec<channels::domain::models::UserName>, Report> {
        Ok(Vec::new())
    }
}

fn request(filters: EntityFilterAst) -> SoupRequest<EntityFilterAst> {
    SoupRequest {
        soup_type: SoupType::Expanded,
        limit: 1,
        cursor: SoupQuery::new_sort_simple(SimpleSortMethod::UpdatedAt, filters),
        sort_direction: SoupSortDirection::Desc,
        user: MacroUserIdStr::parse_from_str(USER).unwrap(),
        email_preview_view: PreviewView::default(),
        link_ids: vec![],
    }
}

fn service(
    repo: MockSoupRepo,
    comms: ReferencingComms,
) -> SoupImpl<
    MockSoupRepo,
    FrecencyQueryServiceImpl<MockFrecencyStorage>,
    NoopEmailPreviewService,
    ReferencingComms,
    NoopCallRecordQueryService,
    FakeCrm,
    NoopPullRequestListing,
> {
    SoupImpl::new(
        repo,
        FrecencyQueryServiceImpl::new(MockFrecencyStorage::new()),
        NoopEmailPreviewService,
        comms,
        NoopCallRecordQueryService,
        FakeCrm,
        NoopPullRequestListing,
    )
}

fn document_ids(expr: &Expr<DocumentLiteral>) -> Vec<Uuid> {
    match expr {
        Expr::Literal(DocumentLiteral::Id(id)) => vec![*id],
        Expr::Or(a, b) => [document_ids(a), document_ids(b)].concat(),
        Expr::And(a, _) => document_ids(a),
        other => panic!("unexpected document filter {other:?}"),
    }
}

#[tokio::test]
async fn company_scope_matches_properties_and_references_of_its_contacts() {
    let comms = ReferencingComms::default();
    let mut repo = MockSoupRepo::new();
    repo.expect_crm_property_edges()
        .times(1)
        .returning(|companies, contacts| {
            assert_eq!(companies, [COMPANY]);
            assert_eq!(contacts, [CONTACT, SIBLING_CONTACT]);
            // A contact-only task: Contacts property without Companies.
            Box::pin(async {
                Ok(vec![
                    CrmPropertyEdge {
                        entity_type: PropertyEntityType::Task,
                        entity_id: Uuid::from_u128(3).to_string(),
                    },
                    CrmPropertyEdge {
                        entity_type: PropertyEntityType::Document,
                        entity_id: Uuid::from_u128(1).to_string(),
                    },
                ])
            })
        });
    repo.expect_expanded_generic_cursor_soup()
        .times(1)
        .returning(|request| {
            let SimpleSortQuery::ItemsFilter(query) = request.cursor else {
                panic!("filtered query")
            };
            let filter = query.filter();
            assert_eq!(filter.crm_association, None);
            let mut documents = document_ids(filter.document_filter.as_deref().unwrap());
            documents.sort();
            // Property-linked, company-mentioning, and contact-mentioning
            // documents, once each.
            assert_eq!(documents, [1, 2, 3].map(Uuid::from_u128));
            Box::pin(async {
                Ok(vec![SoupItem::Document(soup_document_uuid_with_updated(
                    Uuid::from_u128(3),
                    DateTime::default(),
                ))])
            })
        });
    let filters = EntityFilterAst {
        crm_association: Some(Record::Company(COMPANY)),
        ..Default::default()
    };
    let page = service(repo, comms.clone())
        .get_user_soup(request(filters.clone()), None)
        .await
        .unwrap()
        .into_simple()
        .unwrap();

    assert_eq!(page.items.len(), 1);
    // The reply's thread root is the channel row; channels and calls with no
    // association are pruned before their domains are asked.
    assert_eq!(
        *comms.thread_filters.lock().unwrap(),
        vec![format!(
            r#"{{"l":{{"ThreadId":"{}"}}}}"#,
            Uuid::from_u128(0x50)
        )]
    );
    assert_eq!(comms.targets.lock().unwrap()[0].len(), 3);
    // The cursor carries the record, not the resolved ids, so the next page
    // re-authorizes it.
    let cursor: CursorWithValAndFilter<String, SimpleSortMethod, EntityFilterAst> =
        page.next_cursor.unwrap().decode_json().unwrap();
    assert_eq!(
        serde_json::to_value(cursor.filter).unwrap(),
        serde_json::to_value(filters).unwrap()
    );
}

#[tokio::test]
async fn contact_scope_excludes_company_only_and_sibling_items() {
    let comms = ReferencingComms::default();
    let mut repo = MockSoupRepo::new();
    repo.expect_crm_property_edges()
        .times(1)
        .returning(|companies, contacts| {
            assert!(companies.is_empty());
            assert_eq!(contacts, [CONTACT]);
            Box::pin(async { Ok(Vec::new()) })
        });
    repo.expect_expanded_generic_cursor_soup()
        .times(1)
        .returning(|request| {
            let SimpleSortQuery::ItemsFilter(query) = request.cursor else {
                panic!("filtered query")
            };
            // Only a channel reply mentions the contact, so the document
            // source is pinned to nothing.
            assert_eq!(
                document_ids(query.filter().document_filter.as_deref().unwrap()),
                [Uuid::nil()]
            );
            Box::pin(async { Ok(Vec::new()) })
        });
    service(repo, comms.clone())
        .get_user_soup(
            request(EntityFilterAst {
                crm_association: Some(Record::Contact(CONTACT)),
                ..Default::default()
            }),
            None,
        )
        .await
        .unwrap();
    assert_eq!(
        *comms.targets.lock().unwrap(),
        vec![vec![ReferenceTarget {
            entity_type: "crm_contact".into(),
            entity_id: CONTACT.to_string(),
        }]]
    );
}

#[tokio::test]
async fn invisible_records_fail_before_any_source_query() {
    let comms = ReferencingComms::default();
    for record in [
        Record::Company(Uuid::from_u128(0xdead)),
        Record::Contact(Uuid::from_u128(0xbeef)),
    ] {
        // The repo has no expectations: touching it would panic.
        let result = service(MockSoupRepo::new(), comms.clone())
            .get_user_soup(
                request(EntityFilterAst {
                    crm_association: Some(record),
                    ..Default::default()
                }),
                None,
            )
            .await;
        assert_matches!(result, Err(SoupErr::CrmRecordNotFound));
    }
    // A document literal naming an invisible record is denied the same way.
    let result = service(MockSoupRepo::new(), comms.clone())
        .get_user_soup(
            request(EntityFilterAst {
                document_filter: Some(Arc::new(Expr::val(DocumentLiteral::CrmAssociated(
                    Record::Company(Uuid::from_u128(0xdead)),
                )))),
                ..Default::default()
            }),
            None,
        )
        .await;
    assert_matches!(result, Err(SoupErr::CrmRecordNotFound));
    assert!(comms.targets.lock().unwrap().is_empty());
}

#[tokio::test]
async fn associations_require_a_timestamp_sort() {
    let filters = EntityFilterAst {
        crm_association: Some(Record::Company(COMPANY)),
        ..Default::default()
    };
    for cursor in [
        SoupQuery::new_sort_frecency(Frecency, filters.clone()),
        SoupQuery::new_sort_touched(filters.clone()),
        SoupQuery::new_sort_notified(filters.clone()),
    ] {
        let mut request = request(filters.clone());
        request.cursor = cursor;
        let result = service(MockSoupRepo::new(), ReferencingComms::default())
            .get_user_soup(request, None)
            .await;
        assert_matches!(result, Err(SoupErr::AstErr(_)));
    }
}

#[tokio::test]
async fn associations_require_an_expanded_query() {
    let company = Record::Company(COMPANY);
    let comms = ReferencingComms::default();
    for filters in [
        EntityFilterAst {
            crm_association: Some(company),
            ..Default::default()
        },
        EntityFilterAst {
            document_filter: Some(Arc::new(Expr::val(DocumentLiteral::CrmAssociated(company)))),
            ..Default::default()
        },
    ] {
        let mut request = request(filters);
        request.soup_type = SoupType::UnExpanded;
        // The repo has no expectations, so an edge or candidate read panics.
        let result = service(MockSoupRepo::new(), comms.clone())
            .get_user_soup(request, None)
            .await;
        assert_matches!(result, Err(SoupErr::AstErr(_)));
    }
    assert!(comms.targets.lock().unwrap().is_empty());
}
