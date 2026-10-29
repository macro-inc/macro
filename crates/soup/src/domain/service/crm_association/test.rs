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
