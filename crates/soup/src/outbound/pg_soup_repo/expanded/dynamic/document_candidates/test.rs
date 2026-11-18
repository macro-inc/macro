use super::super::{
    DocumentArmAccess, DocumentGrants, DocumentIdArrays, EACH_CANDIDATE_LIMIT, begin_dynamic_query,
    build_query, document_candidate_arm, fetch_user_source_ids, first_document_id_slot,
    push_not_inward,
};
use super::{CandidateArm, DocumentCandidates};
use crate::domain::models::DynamicSort;
use crate::outbound::pg_soup_repo::expanded::tests as seeded;
use chrono::{DateTime, Utc};
use document_sub_type::DocumentSubType;
use filter_ast::Expr;
use item_filters::ast::{
    EntityFilterAst, crm_association::CrmAssociation, document::DocumentLiteral, email::Email,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, email::EmailStr};
use models_pagination::SimpleSortMethod;
use sqlx::{PgPool, Row};
use std::sync::Arc;
use system_properties::{StatusOption, SystemPropertyKey};
use uuid::{Uuid, uuid};

mod pages;
mod participants;

const DOC_A: Uuid = uuid!("22222222-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
const DOC_B: Uuid = uuid!("22222222-bbbb-bbbb-bbbb-bbbbbbbbbbbb");

fn id(id: Uuid) -> Expr<DocumentLiteral> {
    Expr::val(DocumentLiteral::Id(id))
}

fn domain(domain: &str) -> Expr<DocumentLiteral> {
    Expr::val(DocumentLiteral::EmailAttachmentParticipant(Email::Domain(
        domain.to_owned(),
    )))
}

fn address(address: &str) -> Expr<DocumentLiteral> {
    let email = EmailStr::parse_from_str(address).expect("valid address");
    Expr::val(DocumentLiteral::EmailAttachmentParticipant(
        Email::Complete(email.into_owned()),
    ))
}

fn task() -> Expr<DocumentLiteral> {
    Expr::val(DocumentLiteral::SubType(DocumentSubType::Task))
}

fn candidates(ids: &[Uuid], domains: &[&str], addresses: &[&str]) -> DocumentCandidates {
    DocumentCandidates {
        ids: ids.to_vec(),
        domains: domains.iter().map(|d| (*d).to_owned()).collect(),
        addresses: addresses.iter().map(|a| (*a).to_owned()).collect(),
    }
}

#[test]
fn files_tab_filter_names_its_ids_and_participants() {
    // NOT task AND (association ids OR attachment participants), as the CRM
    // record's Files tab asks.
    let expr = Expr::and(
        Expr::is_not(task()),
        Expr::or(
            Expr::or(id(DOC_A), id(DOC_B)),
            Expr::or(domain("Acme.TEST"), address("Pat@Acme.test")),
        ),
    );

    assert_eq!(
        DocumentCandidates::of(&expr),
        Some(candidates(
            &[DOC_A, DOC_B],
            &["acme.test"],
            &["pat@acme.test"]
        ))
    );
}

#[test]
fn an_unbounded_side_of_an_or_leaves_no_candidates() {
    let negated = Expr::or(domain("acme.test"), Expr::is_not(id(DOC_A)));
    let unrelated = Expr::or(domain("acme.test"), task());
    let partial = Expr::or(
        domain("acme.test"),
        Expr::val(DocumentLiteral::EmailAttachmentParticipant(Email::Partial(
            "acme".to_owned(),
        ))),
    );

    assert_eq!(DocumentCandidates::of(&negated), None);
    assert_eq!(DocumentCandidates::of(&unrelated), None);
    assert_eq!(DocumentCandidates::of(&partial), None);
}

#[test]
fn a_filter_without_participants_keeps_its_plan() {
    assert_eq!(
        DocumentCandidates::of(&Expr::or(id(DOC_A), id(DOC_B))),
        None
    );
    assert_eq!(DocumentCandidates::of(&task()), None);
}

#[test]
fn an_unresolved_association_adds_nothing() {
    let expr = Expr::or(
        Expr::val(DocumentLiteral::CrmAssociated(CrmAssociation::Activity)),
        domain("acme.test"),
    );

    assert_eq!(
        DocumentCandidates::of(&expr),
        Some(candidates(&[], &["acme.test"], &[]))
    );
}

#[test]
fn a_conjunction_starts_from_the_side_naming_fewer_participants() {
    let expr = Expr::and(
        Expr::or(domain("acme.test"), domain("acme-mail.test")),
        address("pat@acme.test"),
    );

    assert_eq!(
        DocumentCandidates::of(&expr),
        Some(candidates(&[], &[], &["pat@acme.test"]))
    );
}

/// A filter has candidates only when the bound it keeps names a participant,
/// and checks access after its filters only when it names by id every
/// document it admits. No filter does both: a conjunction with ids keeps the
/// ids, which name no participant.
#[test]
fn candidates_never_meet_access_after_filters() {
    let files_tab = Expr::and(
        Expr::is_not(task()),
        Expr::or(
            Expr::or(id(DOC_A), id(DOC_B)),
            Expr::or(domain("acme.test"), address("pat@acme.test")),
        ),
    );
    let ids = || Expr::or(id(DOC_A), id(DOC_B));
    let cases = [
        (files_tab, true, false),
        (Expr::or(id(DOC_A), domain("acme.test")), true, false),
        (ids(), false, true),
        (Expr::and(ids(), domain("acme.test")), false, true),
        (Expr::and(domain("acme.test"), ids()), false, true),
        (
            Expr::and(Expr::or(id(DOC_A), domain("acme.test")), id(DOC_B)),
            false,
            true,
        ),
    ];

    for (expr, has_candidates, after_filters) in cases {
        assert_eq!(
            DocumentCandidates::of(&push_not_inward(&expr, false)).is_some(),
            has_candidates,
            "{expr:?}"
        );
        assert_eq!(
            matches!(
                DocumentArmAccess::new(Some(&expr), DocumentGrants::Estimated),
                DocumentArmAccess::AfterFilters
            ),
            after_filters,
            "{expr:?}"
        );
    }
}

/// Every row of the first page of `filter`, as the flat query returns it to
/// the fixture's documents' owner, with the document arm started as `arm`
/// says or from the owner's access.
async fn first_page(
    pool: &PgPool,
    filter: &EntityFilterAst,
    arm: Option<CandidateArm>,
) -> anyhow::Result<Vec<(String, String, Option<DateTime<Utc>>, Option<String>)>> {
    let viewer = sqlx::query_scalar!(
        r#"SELECT owner FROM "Document" WHERE id = $1"#,
        seeded::DOC_A
    )
    .fetch_one(pool)
    .await?;
    let sort = DynamicSort::from(SimpleSortMethod::UpdatedAt);
    let mut transaction = begin_dynamic_query(pool).await?;
    let source_ids = fetch_user_source_ids(&mut transaction, &viewer).await?;
    let mut document_ids = DocumentIdArrays::starting_at(first_document_id_slot(sort, false));
    let builder = build_query(
        filter,
        false,
        sort,
        DocumentGrants::Estimated,
        &mut document_ids,
        arm,
    );

    #[expect(clippy::disallowed_methods, reason = "runs SQL generated from the AST")]
    let mut query = sqlx::query(builder.sql())
        .bind(&viewer)
        .bind(sort.timestamp_method().to_string())
        .bind(50_i64)
        .bind(None::<DateTime<Utc>>)
        .bind(None::<String>)
        .bind(StatusOption::COMPLETED_UUID.to_string())
        .bind(SystemPropertyKey::STATUS_UUID)
        .bind(SystemPropertyKey::ASSIGNEES_UUID)
        .bind(&source_ids);
    for ids in document_ids.into_binds() {
        query = query.bind(ids);
    }
    let rows = query.persistent(false).fetch_all(&mut *transaction).await?;
    Ok(rows
        .iter()
        .map(|row| {
            Ok((
                row.try_get("item_type")?,
                row.try_get("id")?,
                row.try_get("sort_ts")?,
                row.try_get("name")?,
            ))
        })
        .collect::<Result<_, sqlx::Error>>()?)
}

/// Copies pat@acme.test on the message doc A's attachment came in, so doc A
/// has two participant rows under acme.test.
async fn add_second_acme_recipient(db: &PgPool) -> anyhow::Result<()> {
    let to_acme = uuid!("ea000001-0000-0000-0000-000000000099");
    let pat = Uuid::now_v7();
    let mut tx = db.begin().await?;
    sqlx::raw_sql("SET LOCAL session_replication_role = 'replica'")
        .execute(&mut *tx)
        .await?;
    sqlx::query!(
        "INSERT INTO email_contacts (id, link_id, email_address)
         SELECT $1, link_id, 'pat@acme.test' FROM email_messages WHERE id = $2",
        pat,
        to_acme,
    )
    .execute(&mut *tx)
    .await?;
    sqlx::raw_sql("SET LOCAL session_replication_role = 'origin'")
        .execute(&mut *tx)
        .await?;
    sqlx::query!(
        "INSERT INTO email_message_recipients (message_id, contact_id, recipient_type) VALUES ($1, $2, 'CC')",
        to_acme,
        pat,
    )
    .execute(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(())
}

fn documents(filter: Expr<DocumentLiteral>) -> EntityFilterAst {
    EntityFilterAst {
        document_filter: Some(Arc::new(filter)),
        ..EntityFilterAst::mock_empty()
    }
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn starting_from_candidates_returns_the_page_access_returns(
    db: PgPool,
) -> anyhow::Result<()> {
    seeded::seed_crm_document_associations(&db, Uuid::now_v7()).await?;
    add_second_acme_recipient(&db).await?;
    let doc_a = Uuid::parse_str(seeded::DOC_A)?;
    let doc_c = uuid!("cccccccc-cccc-cccc-cccc-cccccccccccc");
    let doc_d = uuid!("dddddddd-dddd-dddd-dddd-dddddddddddd");
    let filters = [
        // Doc B's attachment moved off the message to acme.test: its
        // projection rows stay, and the filter drops it. Doc A has two rows
        // under the domain.
        domain("ACME.test"),
        Expr::or(address("vendor@acme.test"), address("pat@acme.test")),
        address("other@globex.test"),
        Expr::or(domain("acme.test"), id(doc_c)),
        // The Files tab's shape.
        Expr::and(
            Expr::is_not(task()),
            Expr::or(
                Expr::or(id(doc_d), id(doc_c)),
                Expr::or(domain("globex.test"), address("vendor@acme.test")),
            ),
        ),
        Expr::and(domain("acme.test"), Expr::is_not(id(doc_a))),
        domain("nobody.test"),
    ];

    for filter in filters {
        let candidates = || {
            DocumentCandidates::of(&push_not_inward(&filter, false))
                .expect("the filter names participants")
        };
        let each = CandidateArm::EachCandidate(candidates());
        let within_access = CandidateArm::WithinAccess(candidates());
        let filter = documents(filter.clone());
        let from_access = first_page(&db, &filter, None).await?;
        assert_eq!(
            first_page(&db, &filter, Some(each)).await?,
            from_access,
            "{filter:?}"
        );
        assert_eq!(
            first_page(&db, &filter, Some(within_access)).await?,
            from_access,
            "{filter:?}"
        );
    }
    let acme = first_page(&db, &documents(domain("acme.test")), None).await?;
    assert_eq!(
        acme.iter()
            .filter(|(item_type, ..)| item_type == "document")
            .map(|(_, id, ..)| id.as_str())
            .collect::<Vec<_>>(),
        [seeded::DOC_A]
    );
    Ok(())
}

/// `participants` ORed with `ids` distinct document ids, as a record's
/// associations are.
fn ids_or(ids: usize, participants: Expr<DocumentLiteral>) -> Expr<DocumentLiteral> {
    fn any_of(mut exprs: Vec<Expr<DocumentLiteral>>) -> Expr<DocumentLiteral> {
        if exprs.len() == 1 {
            return exprs.remove(0);
        }
        let right = exprs.split_off(exprs.len() / 2);
        Expr::or(any_of(exprs), any_of(right))
    }
    let mut exprs: Vec<_> = (0..ids).map(|_| id(Uuid::now_v7())).collect();
    exprs.push(participants);
    any_of(exprs)
}

#[sqlx::test(
    fixtures(
        path = "../../../../../../../macro_db_client/fixtures",
        scripts("entity_filter_tests")
    ),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn the_arm_counts_ids_and_participant_rows_against_the_limit(
    db: PgPool,
) -> anyhow::Result<()> {
    sqlx::query!(
        "INSERT INTO document_email_participants (document_id, address)
         VALUES ($1, 'pat@arm.test'), ($1, 'sam@arm.test')",
        seeded::DOC_A
    )
    .execute(&db)
    .await?;
    let limit = usize::try_from(EACH_CANDIDATE_LIMIT)?;
    let cases = [
        // The domain's two rows.
        (0, domain("arm.test"), true),
        (limit - 2, domain("arm.test"), true),
        (limit - 1, domain("arm.test"), false),
        // Matched lowercased.
        (limit - 1, domain("ARM.test"), false),
        // One row under the address.
        (limit - 1, address("pat@arm.test"), true),
        (limit, address("PAT@Arm.TEST"), false),
        // A domain's rows and an address's, each counted.
        (
            limit - 3,
            Expr::or(domain("arm.test"), address("pat@arm.test")),
            true,
        ),
        (
            limit - 2,
            Expr::or(domain("arm.test"), address("pat@arm.test")),
            false,
        ),
        // More ids than the limit: no count, whatever the participants.
        (limit + 500, domain("arm.test"), false),
    ];

    let mut connection = db.acquire().await?;
    for (ids, participants, each) in cases {
        let filter = ids_or(ids, participants);
        let picked_each = match document_candidate_arm(&mut connection, Some(&filter)).await? {
            Some(CandidateArm::EachCandidate(_)) => Some(true),
            Some(CandidateArm::WithinAccess(_)) => Some(false),
            None => None,
        };
        assert_eq!(picked_each, Some(each), "{ids} ids");
    }
    Ok(())
}

/// The candidates are the ids and the documents whose participants match a
/// domain or a whole address. The arm rechecks the filter on each, so a set
/// wider than this costs reads without changing a page; only this test sees
/// it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_candidates_are_the_ids_and_the_participants_they_name(
    db: PgPool,
) -> anyhow::Result<()> {
    let documents = ["to-pat", "to-sam", "from-lee", "from-kim"].map(String::from);
    let addresses = [
        "pat@acme.test",
        "sam@acme.test",
        "lee@other.test",
        "kim@third.test",
    ]
    .map(String::from);
    sqlx::query!(
        "INSERT INTO document_email_participants (document_id, address)
         SELECT * FROM unnest($1::text[], $2::text[])",
        &documents,
        &addresses,
    )
    .execute(&db)
    .await?;
    let mut arrays = DocumentIdArrays::starting_at(1);
    let union = candidates(&[DOC_A], &["other.test"], &["pat@acme.test"]).union(&mut arrays);

    #[expect(
        clippy::disallowed_methods,
        reason = "runs SQL generated from the candidates"
    )]
    let mut query = sqlx::query_scalar::<_, String>(&union);
    for array in arrays.into_binds() {
        query = query.bind(array);
    }
    let mut named = query.fetch_all(&db).await?;
    named.sort();
    assert_eq!(
        named,
        [DOC_A.to_string(), "from-lee".into(), "to-pat".into()]
    );
    Ok(())
}
