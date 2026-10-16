use crate::domain::{
    association::{CrmAssociation, CrmRecordAssociation},
    companies_repo::CompaniesRepository,
    contact_listing::CrmContactListScope,
};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const VIEWER: &str = "macro|viewer@test.com";
fn id(value: u128) -> Uuid {
    Uuid::from_u128(value)
}
async fn resolve(
    repo: &CompaniesRepositoryImpl,
    scope: CrmContactListScope<'_>,
    record: CrmAssociation,
) -> Option<CrmRecordAssociation> {
    repo.resolve_association(scope, record).await.unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures("fixtures/contact_listing.sql")
)]
async fn company_covers_every_contact_the_viewer_may_see(pool: PgPool) {
    let repo = CompaniesRepositoryImpl::new(pool);
    let viewer = || CrmContactListScope::Viewer(VIEWER);
    // Admin of team 11 sees the hidden contact 1008.
    assert_eq!(
        resolve(&repo, viewer(), CrmAssociation::Company(id(101))).await,
        Some(CrmRecordAssociation::company(
            id(101),
            [1001, 1004, 1008, 1010, 1011].map(id).to_vec()
        ))
    );
    // A plain member of team 12 does not see hidden contact 1007.
    assert_eq!(
        resolve(&repo, viewer(), CrmAssociation::Company(id(102))).await,
        Some(CrmRecordAssociation::company(
            id(102),
            [1002, 1005].map(id).to_vec()
        ))
    );
    // An admin may target a hidden company.
    assert_eq!(
        resolve(&repo, viewer(), CrmAssociation::Company(id(105))).await,
        Some(CrmRecordAssociation::company(id(105), vec![id(1006)]))
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures("fixtures/contact_listing.sql")
)]
async fn invisible_records_do_not_resolve(pool: PgPool) {
    let repo = CompaniesRepositoryImpl::new(pool);
    let viewer = || CrmContactListScope::Viewer(VIEWER);
    for record in [
        // The viewer is not in team 14.
        CrmAssociation::Company(id(104)),
        CrmAssociation::Contact(id(1003)),
        // Hidden from a plain member of team 12.
        CrmAssociation::Contact(id(1007)),
        // Team 13 has CRM disabled.
        CrmAssociation::Company(id(103)),
        CrmAssociation::Contact(id(1009)),
        // Unknown ids.
        CrmAssociation::Company(id(999)),
        CrmAssociation::Contact(id(9999)),
    ] {
        assert_eq!(resolve(&repo, viewer(), record).await, None, "{record:?}");
    }
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures("fixtures/contact_listing.sql")
)]
async fn contact_covers_only_itself(pool: PgPool) {
    let repo = CompaniesRepositoryImpl::new(pool);
    assert_eq!(
        resolve(
            &repo,
            CrmContactListScope::Viewer(VIEWER),
            CrmAssociation::Contact(id(1002))
        )
        .await,
        Some(CrmRecordAssociation::contact(id(1002)))
    );
    // Admins see a contact under a hidden company.
    assert_eq!(
        resolve(
            &repo,
            CrmContactListScope::Viewer(VIEWER),
            CrmAssociation::Contact(id(1006))
        )
        .await,
        Some(CrmRecordAssociation::contact(id(1006)))
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures("fixtures/contact_listing.sql")
)]
async fn team_scope_is_restricted_to_its_team(pool: PgPool) {
    let repo = CompaniesRepositoryImpl::new(pool);
    let team = |include_hidden| CrmContactListScope::Team {
        team_id: id(12),
        include_hidden,
    };
    assert_eq!(
        resolve(&repo, team(false), CrmAssociation::Company(id(102))).await,
        Some(CrmRecordAssociation::company(
            id(102),
            [1002, 1005].map(id).to_vec()
        ))
    );
    assert_eq!(
        resolve(&repo, team(true), CrmAssociation::Company(id(102))).await,
        Some(CrmRecordAssociation::company(
            id(102),
            [1002, 1005, 1007].map(id).to_vec()
        ))
    );
    assert_eq!(
        resolve(&repo, team(false), CrmAssociation::Contact(id(1007))).await,
        None
    );
    assert_eq!(
        resolve(&repo, team(true), CrmAssociation::Company(id(101))).await,
        None
    );
    // A CRM-disabled team's own records do not resolve either.
    let disabled = || CrmContactListScope::Team {
        team_id: id(13),
        include_hidden: true,
    };
    assert_eq!(
        resolve(&repo, disabled(), CrmAssociation::Company(id(103))).await,
        None
    );
    assert_eq!(
        resolve(&repo, disabled(), CrmAssociation::Contact(id(1009))).await,
        None
    );
}
