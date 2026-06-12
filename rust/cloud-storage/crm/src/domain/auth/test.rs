use super::*;
use entity_access::domain::models::{EntityAccessReceipt, EntityType, ViewAccessLevel};

fn company_uuid() -> Uuid {
    Uuid::from_u128(0x1111_1111_1111_1111_1111_1111_1111_1111)
}

fn team_uuid() -> Uuid {
    Uuid::from_u128(0x2222_2222_2222_2222_2222_2222_2222_2222)
}

#[test]
fn company_receipt_exposes_company_id_and_team() {
    let company = company_uuid();
    let team = team_uuid();
    let access = CrmCompanyReceipt::<ViewAccessLevel>::new(
        EntityAccessReceipt::dangerously_assert_internal_user(
            &company.to_string(),
            EntityType::CrmCompany,
        ),
        team,
    );

    assert_eq!(access.company_id().unwrap(), company);
    assert_eq!(access.team_id(), team);
    // dangerously_assert_internal_user grants Owner, which is Edit+.
    assert!(access.include_hidden());
}

#[test]
fn company_receipt_rejects_wrong_entity_type() {
    let access = CrmCompanyReceipt::<ViewAccessLevel>::new(
        EntityAccessReceipt::dangerously_assert_internal_user(
            &company_uuid().to_string(),
            EntityType::Team,
        ),
        team_uuid(),
    );

    assert!(matches!(
        access.company_id(),
        Err(CrmError::InvalidRequest(_))
    ));
}

#[test]
fn contact_receipt_exposes_contact_id() {
    let contact = company_uuid();
    let access = CrmContactReceipt::<ViewAccessLevel>::new(
        EntityAccessReceipt::dangerously_assert_internal_user(
            &contact.to_string(),
            EntityType::CrmContact,
        ),
        team_uuid(),
    );

    assert_eq!(access.contact_id().unwrap(), contact);
}

#[test]
fn team_receipt_from_team_receipt_validates_type_and_id() {
    let team = team_uuid();
    let ok = CrmTeamReceipt::<ViewAccessLevel>::from_team_receipt(
        EntityAccessReceipt::dangerously_assert_internal_user(&team.to_string(), EntityType::Team),
    )
    .unwrap();
    assert_eq!(ok.team_id(), team);

    // Wrong entity type is rejected.
    assert!(
        CrmTeamReceipt::<ViewAccessLevel>::from_team_receipt(
            EntityAccessReceipt::dangerously_assert_internal_user(
                &team.to_string(),
                EntityType::CrmCompany,
            ),
        )
        .is_err()
    );

    // Malformed team id is rejected.
    assert!(matches!(
        CrmTeamReceipt::<ViewAccessLevel>::from_team_receipt(
            EntityAccessReceipt::dangerously_assert_internal_user("not-a-uuid", EntityType::Team),
        ),
        Err(CrmError::InvalidTeamId)
    ));
}

#[test]
fn comment_receipt_derives_entity_and_rejects_non_crm() {
    let entity = company_uuid();
    let access = CrmCommentReceipt::<ViewAccessLevel>::new(
        EntityAccessReceipt::dangerously_assert_internal_user(
            &entity.to_string(),
            EntityType::CrmContact,
        ),
        team_uuid(),
    )
    .unwrap();

    assert_eq!(
        access.comment_entity().unwrap(),
        (CrmCommentEntityType::CrmContact, entity)
    );

    // A receipt for a non-CRM entity cannot mint a comment receipt.
    assert!(
        CrmCommentReceipt::<ViewAccessLevel>::new(
            EntityAccessReceipt::dangerously_assert_internal_user(
                &entity.to_string(),
                EntityType::Team,
            ),
            team_uuid(),
        )
        .is_err()
    );
}
