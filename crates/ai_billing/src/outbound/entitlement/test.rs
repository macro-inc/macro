use super::*;
use crate::domain::BillingPeriod;
use crate::domain::period::{PeriodEvidence, SubscriptionActivity};
use chrono::{DateTime, Duration};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use roles_and_permissions::domain::service::UserRolesAndPermissionsServiceImpl;
use roles_and_permissions::outbound::pgpool::MacroDB;
use sqlx::PgPool;
use teams::outbound::team_repo::TeamRepositoryImpl;

async fn setup_entitlement_test(pool: &PgPool) {
    // Apply both real migration bodies while remapping only the colliding
    // mailbox migration version in the isolated test database.
    let migrations = MACRO_DB_MIGRATIONS
        .iter()
        .map(|migration| {
            let mut migration = migration.clone();
            if migration.version == 20261110150956 && migration.description == "rox mailbox handles"
            {
                migration.version = 20261110150959;
            }
            migration
        })
        .collect::<Vec<_>>();
    sqlx::migrate::Migrator {
        migrations: std::borrow::Cow::Owned(migrations),
        ..sqlx::migrate::Migrator::DEFAULT
    }
    .run(pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!("../../../fixtures/entitlement_teams.sql"))
        .execute(pool)
        .await
        .unwrap();
}

#[sqlx::test(migrations = false)]
async fn only_a_paying_team_bills_its_members_seats(pool: PgPool) {
    setup_entitlement_test(&pool).await;
    let entitlements = RolesTeamsEntitlementSource::new(
        UserRolesAndPermissionsServiceImpl::new(
            MacroDB::new(pool.clone()),
            MacroDB::new(pool.clone()),
        ),
        TeamRepositoryImpl::new(pool),
    );

    let paid_member =
        MacroUserIdStr::try_from("macro|paid-member@example.com".to_string()).unwrap();
    let paid = entitlements.entitlement(&paid_member).await.unwrap();
    assert_eq!(paid.tier, PlanTier::Premium);
    assert_eq!(
        paid.scope,
        PayerScope::TeamMember {
            team_id: Uuid::parse_str("11111111-1111-1111-1111-111111111111").unwrap(),
        }
    );

    let canceled_member =
        MacroUserIdStr::try_from("macro|canceled-member@example.com".to_string()).unwrap();
    assert_eq!(
        entitlements.entitlement(&canceled_member).await.unwrap(),
        Entitlement::personal(canceled_member, PlanTier::Free)
    );
}

#[sqlx::test(migrations = false)]
async fn enterprise_team_still_bills_member_seats(pool: PgPool) {
    setup_entitlement_test(&pool).await;
    let entitlements = RolesTeamsEntitlementSource::new(
        UserRolesAndPermissionsServiceImpl::new(
            MacroDB::new(pool.clone()),
            MacroDB::new(pool.clone()),
        ),
        TeamRepositoryImpl::new(pool),
    );

    let member =
        MacroUserIdStr::try_from("macro|enterprise-member@example.com".to_string()).unwrap();
    let entitlement = entitlements.entitlement(&member).await.unwrap();

    assert!(entitlement.unlimited);
    assert_eq!(
        entitlement.scope,
        PayerScope::TeamMember {
            team_id: Uuid::parse_str("33333333-3333-3333-3333-333333333333").unwrap(),
        }
    );
    assert_eq!(
        entitlement.payer.as_ref(),
        "macro|enterprise-owner@example.com"
    );
    assert_eq!(entitlement.billed_users.len(), 2);
}

#[sqlx::test(migrations = false)]
async fn a_canceled_team_does_not_block_a_members_personal_subscription(pool: PgPool) {
    setup_entitlement_test(&pool).await;
    let entitlements = RolesTeamsEntitlementSource::new(
        UserRolesAndPermissionsServiceImpl::new(
            MacroDB::new(pool.clone()),
            MacroDB::new(pool.clone()),
        ),
        TeamRepositoryImpl::new(pool),
    );
    let at = DateTime::from_timestamp(1_800_000_000, 0).unwrap();
    let personal = SubscriptionPeriod {
        event_id: "evt_personal".parse().unwrap(),
        event_at: at,
        subscription_id: "sub_personal".parse().unwrap(),
        subscription_created_at: at,
        customer_id: "cus_canceled_member".parse().unwrap(),
        team_id: None,
        quantity: 1,
        item_count: 1,
        item_id: "si_personal".parse().unwrap(),
        price_id: "price_40".parse().unwrap(),
        product_id: "prod_40".parse().unwrap(),
        unit_amount: Some(4_000),
        currency: "usd".into(),
        monthly: true,
        activity: SubscriptionActivity::Active,
        period: BillingPeriod {
            start: at,
            end: at + Duration::days(30),
        },
        evidence: PeriodEvidence::Snapshot,
    };

    let member = MacroUserIdStr::try_from("macro|canceled-member@example.com".to_string()).unwrap();
    assert_eq!(
        entitlements.seats(&member, &personal).await.unwrap(),
        Some(vec![member])
    );
}
