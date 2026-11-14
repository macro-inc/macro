use super::*;
use channels::domain::models::ReferencingMessage;
use cool_asserts::assert_matches;

const COMPANY: Uuid = Uuid::from_u128(0xc0);
const CONTACT: Uuid = Uuid::from_u128(0xc1);
const CHANNEL: Uuid = Uuid::from_u128(0xc4a);

fn id(value: u128) -> Uuid {
    Uuid::from_u128(value)
}

fn edge(entity_type: PropertyEntityType, value: u128) -> CrmPropertyEdge {
    CrmPropertyEdge {
        entity_type,
        entity_id: id(value).to_string(),
    }
}

fn message(message_id: u128, thread_id: Option<u128>, parent: MessageParent) -> ReferenceSource {
    ReferenceSource::Message(ReferencingMessage {
        message_id: id(message_id),
        thread_id: thread_id.map(id),
        parent,
    })
}

fn ids(values: &[u128]) -> BTreeSet<Uuid> {
    values.iter().copied().map(id).collect()
}

#[test]
fn edges_group_by_source_and_deduplicate() {
    let entities = AssociatedEntities::from_edges(
        CrmAssociation::Company(COMPANY),
        vec![
            edge(PropertyEntityType::Task, 1),
            edge(PropertyEntityType::Document, 2),
            edge(PropertyEntityType::CallRecord, 3),
            edge(PropertyEntityType::Thread, 4),
            edge(PropertyEntityType::Channel, 5),
            edge(PropertyEntityType::Chat, 6),
            edge(PropertyEntityType::Project, 7),
            edge(PropertyEntityType::CalendarEvent, 8),
            edge(PropertyEntityType::Initiative, 9),
            edge(PropertyEntityType::DatabaseRow, 10),
            // CRM records' own properties: one company also references it
            // from its discussion, and the record naming itself is dropped.
            edge(PropertyEntityType::Company, 11),
            edge(PropertyEntityType::Company, 17),
            edge(PropertyEntityType::Company, 0xc0),
            edge(PropertyEntityType::Contact, 18),
            edge(PropertyEntityType::User, 19),
            CrmPropertyEdge {
                entity_type: PropertyEntityType::Document,
                entity_id: "not-a-uuid".into(),
            },
        ],
        vec![
            // Mentioned by a property-linked task too: still one document.
            ReferenceSource::Document(id(1).to_string()),
            ReferenceSource::Document(id(12).to_string()),
            // A top-level message is its own row; a reply surfaces its root.
            message(20, None, MessageParent::Channel(CHANNEL)),
            message(21, Some(20), MessageParent::Channel(CHANNEL)),
            message(22, Some(23), MessageParent::Channel(CHANNEL)),
            // Discussions make their parent the associated item.
            message(30, None, MessageParent::Document(id(13).to_string())),
            message(31, None, MessageParent::Initiative(id(14))),
            message(32, None, MessageParent::Call(id(15))),
            message(33, None, MessageParent::CrmContact(id(16))),
            message(34, None, MessageParent::CrmCompany(id(17))),
            // The record's own discussion is not an association.
            message(35, None, MessageParent::CrmCompany(COMPANY)),
        ],
    );
    assert_eq!(
        entities,
        AssociatedEntities {
            documents: ids(&[1, 2, 12, 13]),
            chats: ids(&[6]),
            projects: ids(&[7]),
            initiatives: ids(&[9, 14]),
            database_rows: ids(&[10]),
            calendar_events: ids(&[8]),
            email_threads: ids(&[4]),
            calls: ids(&[3, 15]),
            channels: ids(&[5]),
            channel_threads: ids(&[20, 23]),
            crm_companies: ids(&[11, 17]),
            crm_contacts: ids(&[16, 18]),
        }
    );

    let contact = AssociatedEntities::from_edges(
        CrmAssociation::Contact(CONTACT),
        vec![edge(PropertyEntityType::Contact, 0xc1)],
        vec![message(40, None, MessageParent::CrmContact(CONTACT))],
    );
    assert!(contact.crm_contacts.is_empty());
}

fn resolved(entities: AssociatedEntities) -> ResolvedAssociations {
    ResolvedAssociations {
        entities: HashMap::from([(CrmAssociation::Company(COMPANY), entities)]),
        activity_email: None,
    }
}

fn id_set<T: std::fmt::Debug>(
    expr: &Expr<T>,
    literal_id: impl Fn(&T) -> Option<Uuid> + Copy,
) -> BTreeSet<Uuid> {
    match expr {
        Expr::Literal(literal) => literal_id(literal).into_iter().collect(),
        Expr::Or(a, b) => {
            let mut ids = id_set(a, literal_id);
            ids.extend(id_set(b, literal_id));
            ids
        }
        other => panic!("expected an OR of ids, got {other:?}"),
    }
}

fn document_id(literal: &DocumentLiteral) -> Option<Uuid> {
    match literal {
        DocumentLiteral::Id(id) => Some(*id),
        other => panic!("expected a document id, got {other:?}"),
    }
}

#[test]
fn top_level_scope_constrains_every_source_before_its_own_filter() {
    let entities = AssociatedEntities {
        documents: ids(&[1, 2, 3]),
        calls: ids(&[4]),
        channel_threads: ids(&[5]),
        ..AssociatedEntities::default()
    };
    let ast = resolved(entities).apply(EntityFilterAst {
        crm_association: Some(CrmAssociation::Company(COMPANY)),
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::SubType(
            document_sub_type::DocumentSubType::Task,
        )))),
        ..EntityFilterAst::default()
    });

    assert_eq!(ast.crm_association, None);
    assert_matches!(ast.document_filter.as_deref(), Some(Expr::And(ids_tree, task)) => {
        assert_eq!(id_set(ids_tree, document_id), ids(&[1, 2, 3]));
        assert_matches!(task.as_ref(), Expr::Literal(DocumentLiteral::SubType(_)));
    });
    assert_matches!(
        ast.call_filter.as_deref(),
        Some(Expr::Literal(CallLiteral::CallId(call))) if *call == id(4)
    );
    assert_matches!(
        ast.channel_thread_filter.as_deref(),
        Some(Expr::Literal(ChannelThreadLiteral::ThreadId(thread))) if *thread == id(5)
    );
    // Sources without associated entities are pinned to the nil id, which
    // Soup prunes before calling their domains.
    for (tree, what) in [
        (serde_json::to_value(&ast.chat_filter).unwrap(), "chat"),
        (
            serde_json::to_value(&ast.email_filter.tree).unwrap(),
            "email",
        ),
        (
            serde_json::to_value(&ast.channel_filter).unwrap(),
            "channel",
        ),
        (
            serde_json::to_value(&ast.foreign_entity_filter).unwrap(),
            "foreign",
        ),
    ] {
        assert!(
            tree.to_string().contains(&Uuid::nil().to_string()),
            "{what}: {tree}"
        );
    }
    // Opt-in sources stay off.
    assert!(ast.agent_session_filter.is_none());
    assert!(ast.initiative_filter.is_none());
    assert!(ast.database_row_filter.is_none());
    assert!(ast.crm_contact_filter.is_none());
}

#[test]
fn document_literals_resolve_inside_their_tree() {
    let contact = CrmAssociation::Contact(CONTACT);
    let resolved = ResolvedAssociations {
        entities: HashMap::from([(
            contact,
            AssociatedEntities {
                documents: ids(&[7, 8]),
                ..AssociatedEntities::default()
            },
        )]),
        activity_email: None,
    };
    let ast = resolved.apply(EntityFilterAst {
        document_filter: Some(Arc::new(Expr::or(
            Expr::val(DocumentLiteral::CrmAssociated(contact)),
            Expr::val(DocumentLiteral::IsEmailAttachment(true)),
        ))),
        ..EntityFilterAst::default()
    });
    assert_matches!(ast.document_filter.as_deref(), Some(Expr::Or(ids_tree, attachment)) => {
        assert_eq!(id_set(ids_tree, document_id), ids(&[7, 8]));
        assert_matches!(attachment.as_ref(), Expr::Literal(DocumentLiteral::IsEmailAttachment(true)));
    });
    // The other sources are untouched without a top-level scope.
    assert!(ast.call_filter.is_none());

    let empty = ResolvedAssociations::default().apply(EntityFilterAst {
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::CrmAssociated(contact)))),
        ..EntityFilterAst::default()
    });
    assert_matches!(
        empty.document_filter.as_deref(),
        Some(Expr::Literal(DocumentLiteral::Id(nil))) if nil.is_nil()
    );
}

#[test]
fn requested_opt_in_sources_are_constrained() {
    let entities = AssociatedEntities {
        crm_contacts: ids(&[9]),
        crm_companies: ids(&[10]),
        ..AssociatedEntities::default()
    };
    let ast = resolved(entities.clone()).apply(EntityFilterAst {
        crm_association: Some(CrmAssociation::Company(COMPANY)),
        crm_contact_filter: Some(Arc::new(Expr::val(CrmContactLiteral::Include))),
        agent_session_filter: Some(Arc::new(Expr::val(AgentSessionLiteral::Include))),
        ..EntityFilterAst::default()
    });
    assert_matches!(ast.crm_contact_filter.as_deref(), Some(Expr::And(contact, include)) => {
        assert_matches!(contact.as_ref(), Expr::Literal(CrmContactLiteral::Id(contact)) if *contact == id(9));
        assert_matches!(include.as_ref(), Expr::Literal(CrmContactLiteral::Include));
    });
    assert_matches!(ast.agent_session_filter.as_deref(), Some(Expr::And(session, _)) => {
        assert_matches!(session.as_ref(), Expr::Literal(AgentSessionLiteral::Id(nil)) if nil.is_nil());
    });

    let request = |company_ids: Vec<Uuid>| GetCrmCompaniesRequest {
        access: CrmTeamReceipt::from_team_receipt(
            EntityAccessReceipt::dangerously_assert_internal_user(
                &Uuid::from_u128(1).to_string(),
                entity_access::domain::models::EntityType::Team,
            ),
        )
        .unwrap(),
        user_id: MacroUserIdStr::parse_from_str("macro|test@example.com")
            .unwrap()
            .into_owned(),
        company_ids,
        hidden: None,
        sort: crm::domain::companies_repo::CrmCompanyListSort::UpdatedAt,
        cursor: None,
        limit: 20,
    };
    let mut open = request(Vec::new());
    assert!(intersect_crm_companies(&mut open, &entities));
    assert_eq!(open.company_ids, vec![id(10)]);
    let mut other = request(vec![id(11)]);
    assert!(!intersect_crm_companies(&mut other, &entities));
}

#[test]
fn task_scope_keeps_crm_membership_and_disabled_entity_legs() {
    let ast = EntityFilterAst {
        crm_association: Some(CrmAssociation::Company(COMPANY)),
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::SubType(
            document_sub_type::DocumentSubType::Task,
        )))),
        project_filter: Some(Arc::new(Expr::val(ProjectLiteral::ProjectIdSelf(
            Uuid::nil(),
        )))),
        chat_filter: Some(Arc::new(Expr::val(ChatLiteral::ChatId(Uuid::nil())))),
        ..EntityFilterAst::default()
    };

    let scoped = resolved(AssociatedEntities {
        documents: ids(&[1, 2]),
        projects: ids(&[3]),
        chats: ids(&[4]),
        ..AssociatedEntities::default()
    })
    .apply(ast);

    assert_matches!(scoped.document_filter.as_deref(), Some(Expr::And(ids_tree, task)) => {
        assert_eq!(id_set(ids_tree, document_id), ids(&[1, 2]));
        assert_matches!(task.as_ref(), Expr::Literal(DocumentLiteral::SubType(_)));
    });
}

#[test]
fn activity_uses_property_edges_only_and_matches_email_in_every_direction() {
    let entities = AssociatedEntities::from_edges(
        CrmAssociation::Activity,
        vec![
            edge(PropertyEntityType::Document, 1),
            edge(PropertyEntityType::CallRecord, 2),
            edge(PropertyEntityType::Thread, 3),
        ],
        vec![],
    );
    assert_eq!(entities.documents, ids(&[1]));
    assert_eq!(entities.calls, ids(&[2]));
    let email = Email::Domain("example.com".into());
    let email_tree = Arc::new(Expr::or(
        Expr::or(
            Expr::val(EmailLiteral::Sender(email.clone())),
            Expr::val(EmailLiteral::Recipient(email.clone())),
        ),
        Expr::or(
            Expr::val(EmailLiteral::Cc(email.clone())),
            Expr::val(EmailLiteral::Bcc(email)),
        ),
    ));
    let resolved = ResolvedAssociations {
        entities: HashMap::from([(CrmAssociation::Activity, entities)]),
        activity_email: Some(email_tree.clone()),
    };
    let ast = resolved.apply(EntityFilterAst {
        crm_association: Some(CrmAssociation::Activity),
        ..EntityFilterAst::default()
    });
    assert_eq!(ast.email_filter.crm_scope, None);
    assert_eq!(
        serde_json::to_value(&ast.email_filter.tree).unwrap(),
        serde_json::to_value(&Some(email_tree)).unwrap()
    );
    assert_matches!(ast.call_filter.as_deref(), Some(Expr::Literal(CallLiteral::CallId(id))) if *id == Uuid::from_u128(2));
    assert!(
        !serde_json::to_string(&ast.email_filter.tree)
            .unwrap()
            .contains(&Uuid::from_u128(3).to_string())
    );

    let empty = ResolvedAssociations {
        entities: HashMap::from([(CrmAssociation::Activity, AssociatedEntities::default())]),
        activity_email: None,
    }
    .apply(EntityFilterAst {
        crm_association: Some(CrmAssociation::Activity),
        ..EntityFilterAst::default()
    });
    assert_matches!(empty.email_filter.tree.as_deref(), Some(Expr::Literal(EmailLiteral::ThreadId(nil))) if nil.is_nil());
    assert_matches!(empty.call_filter.as_deref(), Some(Expr::Literal(CallLiteral::CallId(nil))) if nil.is_nil());
}

const NIL: &str = "00000000-0000-0000-0000-000000000000";

/// The Sales views' activity requests, as the web sends them
/// (`crmActivityBody`): every source pinned to the nil id but the tab's own.
/// The Tasks view's grouped request pins projects by their own id (`pids`)
/// and adds a status filter. The email tree is in its materialized form
/// (`t`), as the router builds it.
pub(in crate::domain::service) fn sales_view(tab: &str) -> serde_json::Value {
    let mut body = serde_json::json!({
        "crma": "activity",
        "calf": { "l": { "id": NIL } },
        "df": { "l": { "id": NIL } },
        "chanf": { "l": { "ChannelId": NIL } },
        "cthf": { "l": { "ThreadId": NIL } },
        "cf": { "l": { "cid": NIL } },
        "pf": { "l": { "pid": NIL } },
        "callf": { "l": { "CallId": NIL } },
        "ccf": { "l": { "id": NIL } },
        "fef": { "l": { "id": NIL } },
        "ef": { "t": { "l": { "ThreadId": NIL } } },
    });
    let object = body.as_object_mut().unwrap();
    match tab {
        "email" => {
            object.remove("ef");
        }
        "calls" => {
            object.remove("callf");
        }
        "tasks" => {
            object.insert("df".into(), serde_json::json!({ "l": { "dst": "task" } }));
            object.insert("pf".into(), serde_json::json!({ "l": { "pids": NIL } }));
            let status = |option: &str| {
                serde_json::json!({ "l": {
                    "pd": "00000001-0000-0000-0000-000000000002",
                    "v": { "so": option },
                } })
            };
            object.insert(
                "propf".into(),
                serde_json::json!({ "|": [
                    status("00000001-0000-0000-0002-000000000002"),
                    { "|": [
                        status("00000001-0000-0000-0002-000000000003"),
                        status("00000001-0000-0000-0002-000000000001"),
                    ] },
                ] }),
            );
        }
        "notes" => {
            object.insert(
                "df".into(),
                serde_json::json!({ "&": [
                    { "l": { "ft": "md" } },
                    { "!": { "|": [
                        { "l": { "dst": "task" } },
                        { "|": [{ "l": { "dst": "snippet" } }, { "l": { "dst": "skill" } }] },
                    ] } },
                ] }),
            );
        }
        other => panic!("unknown tab {other}"),
    }
    body
}

pub(in crate::domain::service) fn ast(value: serde_json::Value) -> EntityFilterAst {
    serde_json::from_value(value).unwrap()
}

#[test]
fn sales_views_read_only_their_own_source() {
    use PropertyEntityType::{CallRecord, Document, Task};
    let reads = |tab| ActivityReads::of(&ast(sales_view(tab))).unwrap();
    assert_eq!(
        reads("tasks"),
        ActivityReads {
            email: false,
            entity_types: vec![Document, Task],
        }
    );
    assert_eq!(reads("notes"), reads("tasks"));
    assert!(ast(sales_view("tasks")).properties_filter.is_some());
    assert_eq!(
        reads("calls"),
        ActivityReads {
            email: false,
            entity_types: vec![CallRecord],
        }
    );
    assert_eq!(
        reads("email"),
        ActivityReads {
            email: true,
            entity_types: vec![],
        }
    );
}

/// Requests whose reads differ, each compared with reading everything.
fn activity_requests() -> Vec<(&'static str, EntityFilterAst)> {
    let real = id(0x5ea1).to_string();
    let with = |tab, key: &str, value: serde_json::Value| {
        let mut body = sales_view(tab);
        body.as_object_mut().unwrap().insert(key.into(), value);
        ast(body)
    };
    vec![
        ("tasks", ast(sales_view("tasks"))),
        ("notes", ast(sales_view("notes"))),
        ("calls", ast(sales_view("calls"))),
        ("email", ast(sales_view("email"))),
        (
            "nothing pinned",
            ast(serde_json::json!({ "crma": "activity" })),
        ),
        (
            "nil or a real document",
            with(
                "email",
                "df",
                serde_json::json!({ "|": [{ "l": { "id": NIL } }, { "l": { "id": real } }] }),
            ),
        ),
        (
            "not nil",
            with(
                "tasks",
                "cf",
                serde_json::json!({ "!": { "l": { "cid": NIL } } }),
            ),
        ),
        (
            "nil and a real company",
            with(
                "tasks",
                "ccf",
                serde_json::json!({ "&": [{ "l": { "id": NIL } }, { "l": { "id": real } }] }),
            ),
        ),
        (
            "contacts and initiatives",
            with("tasks", "crmf", serde_json::json!({ "l": "include" })),
        ),
        (
            "initiatives",
            with("tasks", "if", serde_json::json!({ "l": "inc" })),
        ),
        (
            "documents naming the scope",
            EntityFilterAst {
                document_filter: Some(Arc::new(Expr::val(DocumentLiteral::CrmAssociated(
                    CrmAssociation::Activity,
                )))),
                ..EntityFilterAst::default()
            },
        ),
        (
            "documents naming the scope, pinned to nil",
            EntityFilterAst {
                document_filter: Some(Arc::new(Expr::and(
                    Expr::val(DocumentLiteral::CrmAssociated(CrmAssociation::Activity)),
                    Expr::val(DocumentLiteral::Id(Uuid::nil())),
                ))),
                ..EntityFilterAst::default()
            },
        ),
    ]
}

fn json<T: serde::Serialize>(value: &T) -> serde_json::Value {
    serde_json::to_value(value).unwrap()
}

/// Every source either gets the tree reading everything gives it, or matches
/// nothing either way.
#[test]
fn reads_leave_out_only_what_matches_nothing() {
    let all_types = [
        PropertyEntityType::CalendarEvent,
        PropertyEntityType::CallRecord,
        PropertyEntityType::Channel,
        PropertyEntityType::Chat,
        PropertyEntityType::Company,
        PropertyEntityType::DatabaseRow,
        PropertyEntityType::Contact,
        PropertyEntityType::Document,
        PropertyEntityType::Initiative,
        PropertyEntityType::Project,
        PropertyEntityType::Task,
        PropertyEntityType::Thread,
        PropertyEntityType::User,
    ];
    let edges = |types: &[PropertyEntityType]| {
        all_types
            .iter()
            .enumerate()
            .filter(|(_, entity_type)| types.contains(entity_type))
            .map(|(index, entity_type)| edge(*entity_type, 0xe0 + index as u128))
            .collect::<Vec<_>>()
    };
    let participants = participant_tree(&CrmRecordAssociation {
        domains: vec!["example.com".into()],
        addresses: vec!["pat@example.org".into()],
        ..CrmRecordAssociation::default()
    });
    assert!(participants.is_some());
    for (name, request) in activity_requests() {
        let reads = ActivityReads::of(&request).unwrap();
        let resolve = |types: &[PropertyEntityType], email: bool| ResolvedAssociations {
            entities: HashMap::from([(
                CrmAssociation::Activity,
                AssociatedEntities::from_edges(CrmAssociation::Activity, edges(types), vec![]),
            )]),
            activity_email: email.then(|| participants.clone()).flatten(),
        };
        let everything = resolve(&all_types, true);
        let read = resolve(&reads.entity_types, reads.email);
        let old = everything.apply(request.clone());
        let new = read.apply(request.clone());
        let same_or_empty =
            |field: &str,
             old_tree: serde_json::Value,
             new_tree: serde_json::Value,
             empty: fn(Option<&EntityFilterAst>) -> bool| {
                assert!(
                    old_tree == new_tree || (empty(Some(&old)) && empty(Some(&new))),
                    "{name}: {field} differs and is not empty: {old_tree} vs {new_tree}"
                );
            };
        same_or_empty(
            "documents",
            json(&old.document_filter),
            json(&new.document_filter),
            exclusions::document,
        );
        same_or_empty(
            "chats",
            json(&old.chat_filter),
            json(&new.chat_filter),
            exclusions::chat,
        );
        same_or_empty(
            "projects",
            json(&old.project_filter),
            json(&new.project_filter),
            exclusions::project,
        );
        same_or_empty(
            "channels",
            json(&old.channel_filter),
            json(&new.channel_filter),
            exclusions::channel,
        );
        same_or_empty(
            "calls",
            json(&old.call_filter),
            json(&new.call_filter),
            exclusions::call,
        );
        same_or_empty(
            "calendar events",
            json(&old.calendar_event_filter),
            json(&new.calendar_event_filter),
            exclusions::calendar_event,
        );
        same_or_empty(
            "email",
            json(&old.email_filter.tree),
            json(&new.email_filter.tree),
            exclusions::email,
        );
        for (field, old_tree, new_tree) in [
            (
                "channel threads",
                json(&old.channel_thread_filter),
                json(&new.channel_thread_filter),
            ),
            (
                "foreign entities",
                json(&old.foreign_entity_filter),
                json(&new.foreign_entity_filter),
            ),
            (
                "initiatives",
                json(&old.initiative_filter),
                json(&new.initiative_filter),
            ),
            (
                "contacts",
                json(&old.crm_contact_filter),
                json(&new.crm_contact_filter),
            ),
            (
                "companies",
                json(&old.crm_company_filter),
                json(&new.crm_company_filter),
            ),
        ] {
            assert_eq!(old_tree, new_tree, "{name}: {field}");
        }
        // Only a top-level scope narrows the company leg.
        let companies = |resolved: &ResolvedAssociations| {
            resolved
                .get(&CrmAssociation::Activity)
                .unwrap()
                .crm_companies
                .clone()
        };
        assert!(
            request.crm_association.is_none()
                || companies(&everything) == companies(&read)
                || company_ids_all_nil(request.crm_company_filter.as_deref()),
            "{name}: companies"
        );
    }
}

#[test]
fn database_rows_take_the_record_path() {
    let mut body = sales_view("tasks");
    body.as_object_mut()
        .unwrap()
        .insert("drf".into(), serde_json::json!({ "l": "inc" }));
    assert_eq!(ActivityReads::of(&ast(body)), None);
    // Rows read through a document literal are not constrained by the scope.
    let rows = EntityFilterAst {
        database_row_filter: Some(Arc::new(Expr::val(DatabaseRowLiteral::Include))),
        document_filter: Some(Arc::new(Expr::val(DocumentLiteral::CrmAssociated(
            CrmAssociation::Activity,
        )))),
        ..EntityFilterAst::default()
    };
    assert!(ActivityReads::of(&rows).is_some());
}

#[test]
fn company_ids_all_nil_follows_the_id_list() {
    let tree = |value: serde_json::Value| {
        serde_json::from_value::<Expr<CrmCompanyLiteral>>(value).unwrap()
    };
    let real = id(0x5ea1).to_string();
    for (value, all_nil) in [
        (serde_json::json!({ "l": { "id": NIL } }), true),
        (
            serde_json::json!({ "&": [{ "l": { "id": NIL } }, { "l": { "hidden": true } }] }),
            true,
        ),
        (
            serde_json::json!({ "|": [{ "l": { "id": NIL } }, { "l": { "id": NIL } }] }),
            true,
        ),
        (
            serde_json::json!({ "&": [{ "l": { "id": NIL } }, { "l": { "id": real } }] }),
            false,
        ),
        (serde_json::json!({ "l": { "hidden": false } }), false),
    ] {
        assert_eq!(
            company_ids_all_nil(Some(&tree(value.clone()))),
            all_nil,
            "{value}"
        );
    }
    assert!(!company_ids_all_nil(None));
}
