use crate::domain::{
    companies_repo::{CompaniesRepository, CrmCompanyListSort, CrmCompanySoupCursor},
    contact_listing::{CrmContactForSoup, CrmContactListQuery, CrmContactListScope},
};
use crate::outbound::companies_repo::CompaniesRepositoryImpl;
use filter_ast::Expr;
use item_filters::ast::crm_contact::CrmContactLiteral as Contact;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use uuid::Uuid;

const VIEWER: &str = "macro|viewer@test.com";
fn id(value: u128) -> Uuid {
    Uuid::from_u128(value)
}
fn request(filter: Expr<Contact>) -> CrmContactListQuery {
    CrmContactListQuery {
        filter,
        sort: CrmCompanyListSort::UpdatedAt,
        cursor: None,
        ascending: false,
        limit: 100,
    }
}
fn ids(rows: &[CrmContactForSoup]) -> Vec<Uuid> {
    rows.iter().map(|row| row.contact.id).collect()
}
async fn list(repo: &CompaniesRepositoryImpl, filter: Expr<Contact>) -> Vec<CrmContactForSoup> {
    repo.list_contacts_for_soup(
        CrmContactListScope::Viewer(VIEWER),
        VIEWER,
        &request(filter),
    )
    .await
    .unwrap()
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures("fixtures/contact_listing.sql")
)]
async fn combines_authorized_teams_before_collapsing_email(pool: PgPool) {
    let repo = CompaniesRepositoryImpl::new(pool);
    let rows = list(&repo, Expr::val(Contact::Include)).await;
    assert_eq!(ids(&rows), [1011, 1005, 1004, 1010].map(id));
    assert_eq!(rows[0].team_id, id(11));
    assert_eq!(rows[0].company_name, "Company 101");
    assert!(
        list(&repo, Expr::val(Contact::TeamId(id(14))))
            .await
            .is_empty()
    );
    assert!(
        list(&repo, Expr::val(Contact::TeamId(id(13))))
            .await
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures("fixtures/contact_listing.sql")
)]
async fn filters_team_records_before_deduplication_and_preserves_exact_ids(pool: PgPool) {
    let repo = CompaniesRepositoryImpl::new(pool);
    assert_eq!(
        ids(&list(
            &repo,
            Expr::val(Contact::Email("  pat@EXAMPLE.com ".into()))
        )
        .await),
        [id(1011)]
    );
    assert_eq!(
        ids(&list(&repo, Expr::val(Contact::TeamId(id(12)))).await),
        [id(1002), id(1005)]
    );
    assert_eq!(
        ids(&list(
            &repo,
            Expr::and(
                Expr::val(Contact::CompanyId(id(101))),
                Expr::val(Contact::Search("OLD PAT".into()))
            )
        )
        .await),
        [id(1001)]
    );
    let records = list(
        &repo,
        Expr::or(
            Expr::val(Contact::Id(id(1001))),
            Expr::val(Contact::Id(id(1002))),
        ),
    )
    .await;
    assert_eq!(ids(&records), [id(1002), id(1001)]);
    assert!(
        list(&repo, Expr::val(Contact::Search("%' OR TRUE --".into())))
            .await
            .is_empty()
    );
    assert!(
        list(&repo, Expr::val(Contact::Search("_".into())))
            .await
            .is_empty()
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures("fixtures/contact_listing.sql")
)]
async fn hidden_access_uses_each_owning_teams_role(pool: PgPool) {
    let repo = CompaniesRepositoryImpl::new(pool);
    assert_eq!(
        ids(&list(&repo, Expr::val(Contact::Hidden(true))).await),
        [id(1006), id(1008)]
    );
    assert_eq!(
        ids(&list(&repo, Expr::is_not(Expr::val(Contact::Hidden(false)))).await),
        [id(1006), id(1008)]
    );
    assert!(
        list(&repo, Expr::val(Contact::Id(id(1007))))
            .await
            .is_empty()
    );
    assert_eq!(
        ids(&list(&repo, Expr::val(Contact::Id(id(1006)))).await),
        [id(1006)]
    );
    let rows = repo
        .list_contacts_for_soup(
            CrmContactListScope::Team {
                team_id: id(12),
                include_hidden: false,
            },
            VIEWER,
            &request(Expr::val(Contact::Include)),
        )
        .await
        .unwrap();
    assert_eq!(ids(&rows), [id(1002), id(1005)]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures("fixtures/contact_listing.sql")
)]
async fn keyset_pages_never_repeat_or_skip_deduplicated_contacts(pool: PgPool) {
    let repo = CompaniesRepositoryImpl::new(pool);
    for ascending in [false, true] {
        for sort in [
            CrmCompanyListSort::CreatedAt,
            CrmCompanyListSort::UpdatedAt,
            CrmCompanyListSort::ViewedAt,
            CrmCompanyListSort::ViewedUpdated,
        ] {
            let mut query = request(Expr::val(Contact::Include));
            query.sort = sort;
            query.ascending = ascending;
            let expected = repo
                .list_contacts_for_soup(CrmContactListScope::Viewer(VIEWER), VIEWER, &query)
                .await
                .unwrap();
            query.limit = 1;
            let mut found = Vec::new();
            for _ in 0..10 {
                let page = repo
                    .list_contacts_for_soup(CrmContactListScope::Viewer(VIEWER), VIEWER, &query)
                    .await
                    .unwrap();
                let Some(row) = page.last() else { break };
                query.cursor = Some(CrmCompanySoupCursor {
                    last_id: row.contact.id,
                    last_sort_ts: match sort {
                        CrmCompanyListSort::CreatedAt => row.contact.first_interaction,
                        CrmCompanyListSort::UpdatedAt => row.contact.last_interaction,
                        CrmCompanyListSort::ViewedAt => row.viewed_at.unwrap_or_default(),
                        CrmCompanyListSort::ViewedUpdated => {
                            row.viewed_at.unwrap_or(row.contact.last_interaction)
                        }
                    },
                });
                found.extend(ids(&page));
            }
            assert_eq!(found, ids(&expected));
        }
    }
}
