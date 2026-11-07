//! Integration tests for sharing a personal label with a team.

use macro_db_migrator::MACRO_DB_MIGRATIONS;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::{DataType, EntityType};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

use super::properties_pg_repo::PropertiesPgRepo;
use crate::domain::model::{PropertyDefinitionOwner, TagPromotionOutcome};
use crate::domain::ports::PropertiesRepo;

const USER1_TAG_DEFINITION: &str = "aa111111-1111-1111-1111-111111111111";
const TEAM1_TAG_DEFINITION: &str = "aa222222-2222-2222-2222-222222222222";
const USER1_BUG_REPORT: &str = "0aa11111-1111-1111-1111-111111111111";
const USER1_MOBILE: &str = "0aa11111-1111-1111-1111-111111111112";
const TEAM1_URGENT: &str = "0aa22222-2222-2222-2222-222222222222";

fn uuid(value: &str) -> Uuid {
    value.parse().unwrap()
}

/// The option ids stored on one entity's value for a property definition.
async fn stored_option_ids(
    pool: &Pool<Postgres>,
    entity_id: &str,
    definition_id: Uuid,
) -> Vec<Uuid> {
    let value = sqlx::query_scalar!(
        r#"
        SELECT values as "values: serde_json::Value"
        FROM entity_properties
        WHERE entity_id = $1 AND entity_type = 'DOCUMENT' AND property_definition_id = $2
        "#,
        entity_id,
        definition_id,
    )
    .fetch_optional(pool)
    .await
    .unwrap()
    .flatten();

    match value.map(serde_json::from_value::<PropertyValue>) {
        Some(Ok(PropertyValue::SelectOption(ids))) => ids,
        _ => Vec::new(),
    }
}

/// Attach `option_id` of `definition_id` to a document.
async fn tag_document(
    pool: &Pool<Postgres>,
    entity_id: &str,
    definition_id: Uuid,
    option_ids: &[Uuid],
) {
    let value = serde_json::json!({
        "type": "SelectOption",
        "value": option_ids.iter().map(|id| id.to_string()).collect::<Vec<_>>(),
    });
    sqlx::query!(
        r#"
        INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values)
        VALUES ($1, $2, 'DOCUMENT', $3, $4)
        ON CONFLICT (entity_id, entity_type, property_definition_id)
        DO UPDATE SET values = $4
        "#,
        macro_uuid::generate_uuid_v7(),
        entity_id,
        definition_id,
        value,
    )
    .execute(pool)
    .await
    .unwrap();
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties", "tags"))
)]
async fn promote_moves_label_and_retags_entities(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let source = uuid(USER1_TAG_DEFINITION);
    let target = uuid(TEAM1_TAG_DEFINITION);
    let option = uuid(USER1_BUG_REPORT);

    let TagPromotionOutcome::Promoted(remap) =
        repo.promote_tag_option(option, source, target).await?
    else {
        panic!("expected the promotion to succeed");
    };

    // The option keeps its id, so entities that already carry it stay tagged.
    assert_eq!(remap.option.id, option);
    assert_eq!(remap.option.property_definition_id, target);
    assert_eq!(
        remap.option.value,
        PropertyOptionValue::String("bug-report".to_string())
    );
    // Appended after the team's existing label rather than reusing its order.
    assert_eq!(remap.option.display_order, 1);

    // tagdoc1 already had the team's `urgent` label; the promoted one is added.
    assert_eq!(
        stored_option_ids(&pool, "tagdoc1", target).await,
        vec![uuid(TEAM1_URGENT), option]
    );
    assert!(stored_option_ids(&pool, "tagdoc1", source).await.is_empty());

    assert_eq!(remap.mutations.len(), 1);
    assert_eq!(remap.mutations[0].property.entity_id, "tagdoc1");
    assert_eq!(
        remap.mutations[0].property.property_definition_id, target,
        "events must point at the team definition search rebuilds from"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties", "tags"))
)]
async fn promote_attaches_the_team_property_when_absent(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let source = uuid(USER1_TAG_DEFINITION);
    let target = uuid(TEAM1_TAG_DEFINITION);
    let option = uuid(USER1_MOBILE);

    // A document tagged only with the personal label has no team tag row yet.
    tag_document(&pool, "untagged-by-team", source, &[option]).await;

    let TagPromotionOutcome::Promoted(remap) =
        repo.promote_tag_option(option, source, target).await?
    else {
        panic!("expected the promotion to succeed");
    };

    assert_eq!(
        stored_option_ids(&pool, "untagged-by-team", target).await,
        vec![option]
    );
    assert!(
        stored_option_ids(&pool, "untagged-by-team", source)
            .await
            .is_empty()
    );
    assert_eq!(remap.mutations.len(), 1);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties", "tags"))
)]
async fn promote_reports_a_case_insensitive_name_collision(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let source = uuid(USER1_TAG_DEFINITION);
    let target = uuid(TEAM1_TAG_DEFINITION);

    let clashing = repo
        .create_property_option(
            source,
            2,
            PropertyOptionValue::String("  URGENT ".to_string()),
            Some("#00ff00".to_string()),
        )
        .await?;

    let TagPromotionOutcome::Conflict(conflict) =
        repo.promote_tag_option(clashing.id, source, target).await?
    else {
        panic!("expected a conflict with the team's `urgent` label");
    };
    assert_eq!(conflict.id, uuid(TEAM1_URGENT));

    // The rejected promotion leaves both tag sets exactly as they were.
    let promoted = repo.get_property_option(clashing.id).await?.unwrap();
    assert_eq!(promoted.property_definition_id, source);
    assert_eq!(repo.get_property_options(target).await?.len(), 1);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties", "tags"))
)]
async fn concurrent_promotions_of_one_name_produce_a_single_team_label(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let target = uuid(TEAM1_TAG_DEFINITION);
    let user1_definition = uuid(USER1_TAG_DEFINITION);
    let user2_definition = uuid("aa333333-3333-3333-3333-333333333333");

    // Two teammates each hold a personal label for the same thing, spelled
    // differently, and share it at the same moment.
    let first = repo
        .create_property_option(
            user1_definition,
            0,
            PropertyOptionValue::String("Design Review".to_string()),
            Some("#ff0000".to_string()),
        )
        .await?;
    let second = repo
        .create_property_option(
            user2_definition,
            0,
            PropertyOptionValue::String("design review".to_string()),
            Some("#00ff00".to_string()),
        )
        .await?;

    let (first_outcome, second_outcome) = tokio::join!(
        repo.promote_tag_option(first.id, user1_definition, target),
        repo.promote_tag_option(second.id, user2_definition, target),
    );

    // Whoever loses the race is told to merge instead of adding a duplicate.
    let outcomes = [first_outcome?, second_outcome?];
    let promoted: Vec<_> = outcomes
        .iter()
        .filter_map(|outcome| match outcome {
            TagPromotionOutcome::Promoted(remap) => Some(remap.option.id),
            TagPromotionOutcome::Conflict(_) => None,
        })
        .collect();
    let conflicts: Vec<_> = outcomes
        .iter()
        .filter_map(|outcome| match outcome {
            TagPromotionOutcome::Conflict(conflict) => Some(conflict.id),
            TagPromotionOutcome::Promoted(_) => None,
        })
        .collect();

    assert_eq!(promoted.len(), 1, "exactly one promotion may win");
    assert_eq!(conflicts, promoted, "the loser is pointed at the winner");

    let team_labels = repo.get_property_options(target).await?;
    assert_eq!(
        team_labels
            .iter()
            .filter(|label| matches!(
                &label.value,
                PropertyOptionValue::String(value) if value.eq_ignore_ascii_case("design review")
            ))
            .count(),
        1
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties", "tags"))
)]
async fn merge_retags_entities_onto_the_team_label(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let source = uuid(USER1_TAG_DEFINITION);
    let target = uuid(TEAM1_TAG_DEFINITION);
    let personal = uuid(USER1_BUG_REPORT);
    let team = uuid(TEAM1_URGENT);

    // One document has only the personal label, one has both.
    tag_document(&pool, "personal-only", source, &[personal]).await;

    let remap = repo
        .merge_tag_option(personal, source, team, target)
        .await?
        .expect("the team label exists");

    assert_eq!(remap.option.id, team);
    assert_eq!(
        remap.option.value,
        PropertyOptionValue::String("urgent".to_string()),
        "the team label's name wins"
    );

    // The document that already had the team label is not double-tagged.
    assert_eq!(
        stored_option_ids(&pool, "tagdoc1", target).await,
        vec![team]
    );
    assert_eq!(
        stored_option_ids(&pool, "personal-only", target).await,
        vec![team]
    );
    assert!(stored_option_ids(&pool, "tagdoc1", source).await.is_empty());
    assert!(
        stored_option_ids(&pool, "personal-only", source)
            .await
            .is_empty()
    );

    assert!(
        repo.get_property_option(personal).await?.is_none(),
        "the personal label is retired"
    );
    assert_eq!(remap.mutations.len(), 2);

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties", "tags"))
)]
async fn merge_rejects_a_target_outside_the_team_tag_set(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let source = uuid(USER1_TAG_DEFINITION);
    let target = uuid(TEAM1_TAG_DEFINITION);
    let personal = uuid(USER1_BUG_REPORT);
    // Another user's personal label, which is not in the team's set.
    let foreign = uuid("0aa33333-3333-3333-3333-333333333333");

    assert!(
        repo.merge_tag_option(personal, source, foreign, target)
            .await?
            .is_none()
    );

    assert!(repo.get_property_option(personal).await?.is_some());
    assert_eq!(
        stored_option_ids(&pool, "tagdoc1", source).await,
        vec![personal],
        "a rejected merge leaves the personal tagging alone"
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties", "tags"))
)]
async fn promoted_label_reads_back_from_the_team_tag_set(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    let option = uuid(USER1_BUG_REPORT);

    repo.promote_tag_option(
        option,
        uuid(USER1_TAG_DEFINITION),
        uuid(TEAM1_TAG_DEFINITION),
    )
    .await?;

    // user3 is on Team 1 but never had the personal label, so this asserts the
    // whole point of promotion: the label is now theirs to see and use.
    let user3 = macro_user_id::user_id::MacroUserIdStr::try_from("macro|user3@test.com")?;
    let visible = repo.get_caller_tag_definitions(user3.as_ref()).await?;
    let team_labels = visible
        .iter()
        .find(|set| set.definition.id == uuid(TEAM1_TAG_DEFINITION))
        .expect("user3 sees the team tag set");
    assert!(
        team_labels
            .property_options
            .iter()
            .any(|label| label.id == option)
    );

    let tagged = repo
        .get_entity_properties("tagdoc1", EntityType::Document, user3.as_ref())
        .await?;
    let team_tags = tagged
        .iter()
        .find(|property| {
            property.data_type == DataType::Tag
                && property.property_definition_id == uuid(TEAM1_TAG_DEFINITION)
        })
        .expect("the team tag property is attached to tagdoc1");
    assert!(matches!(
        &team_tags.value,
        Some(PropertyValue::SelectOption(ids)) if ids.contains(&option)
    ));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../fixtures", scripts("properties", "tags"))
)]
async fn promote_provisions_a_team_tag_set_on_demand(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let repo = PropertiesPgRepo::new(pool.clone());
    // Team 2 has no tag definition in the fixtures.
    let team2 = uuid("0e000000-0000-0000-0000-000000000002");
    let provisioned = repo
        .get_or_create_tag_definition(PropertyDefinitionOwner::Team(team2))
        .await?;
    assert!(provisioned.created);

    let option = uuid(USER1_BUG_REPORT);
    let TagPromotionOutcome::Promoted(remap) = repo
        .promote_tag_option(
            option,
            uuid(USER1_TAG_DEFINITION),
            provisioned.definition.id,
        )
        .await?
    else {
        panic!("an empty team tag set cannot collide");
    };

    assert_eq!(remap.option.display_order, 0);
    assert_eq!(
        stored_option_ids(&pool, "tagdoc1", provisioned.definition.id).await,
        vec![option]
    );

    Ok(())
}
