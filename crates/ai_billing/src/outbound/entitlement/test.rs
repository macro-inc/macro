use super::*;
use crate::domain::BillingPeriod;
use crate::domain::period::{PeriodEvidence, SubscriptionActivity};
use chrono::{DateTime, Duration};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use roles_and_permissions::domain::service::UserRolesAndPermissionsServiceImpl;
use roles_and_permissions::outbound::pgpool::MacroDB;
use sqlx::PgPool;
use teams::outbound::team_repo::TeamRepositoryImpl;

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("entitlement_teams"))
)]
async fn only_a_paying_team_bills_its_members_seats(pool: PgPool) {
    let entitlements = RolesTeamsEntitlementSource::new(
        UserRolesAndPermissionsServiceImpl::new(MacroDB::new(pool.clone())),
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
        Entitlement::personal(canceled_member.clone(), PlanTier::Free)
    );

    // Lightweight single-user plan lookup agrees with full entitlement without
    // scanning the team's full roster.
    assert_eq!(
        entitlements.user_plan(&paid_member).await.unwrap(),
        UserPlan {
            tier: PlanTier::Premium,
            unlimited: false,
        }
    );
    assert_eq!(
        entitlements.user_plan(&canceled_member).await.unwrap(),
        UserPlan {
            tier: PlanTier::Free,
            unlimited: false,
        }
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("entitlement_teams"))
)]
async fn user_plan_distinguishes_business_max_enterprise_and_personal_tiers(pool: PgPool) {
    let entitlements = RolesTeamsEntitlementSource::new(
        UserRolesAndPermissionsServiceImpl::new(MacroDB::new(pool.clone())),
        TeamRepositoryImpl::new(pool.clone()),
    );
    let paid_member =
        MacroUserIdStr::try_from("macro|paid-member@example.com".to_string()).unwrap();
    sqlx::query!(
        "UPDATE team_user SET plan = 'business' WHERE user_id = $1",
        paid_member.as_ref()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        entitlements.user_plan(&paid_member).await.unwrap(),
        UserPlan {
            tier: PlanTier::Business,
            unlimited: false,
        }
    );

    sqlx::query!(
        "UPDATE team SET enterprise = TRUE WHERE id = '11111111-1111-1111-1111-111111111111'"
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        entitlements.user_plan(&paid_member).await.unwrap(),
        UserPlan {
            tier: PlanTier::Business,
            unlimited: true,
        }
    );

    let canceled_member =
        MacroUserIdStr::try_from("macro|canceled-member@example.com".to_string()).unwrap();
    sqlx::query!(
        r#"INSERT INTO "RolesOnUsers" ("userId", "roleId") VALUES ($1, 'sub_business')"#,
        canceled_member.as_ref()
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        entitlements.user_plan(&canceled_member).await.unwrap(),
        UserPlan {
            tier: PlanTier::Business,
            unlimited: false,
        }
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("entitlement_teams"))
)]
async fn a_canceled_team_does_not_block_a_members_personal_subscription(pool: PgPool) {
    let entitlements = RolesTeamsEntitlementSource::new(
        UserRolesAndPermissionsServiceImpl::new(MacroDB::new(pool.clone())),
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
