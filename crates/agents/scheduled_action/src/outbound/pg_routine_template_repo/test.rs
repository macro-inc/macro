use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::json;

use super::*;
use crate::domain::ports::ScheduledActionRepo;
use crate::domain::templates::{TemplateVariable, VariableFill};
use crate::outbound::pg_scheduled_action_repo::test::{
    USER_A, USER_B, insert_user, sample_action, test_repo, user_owner,
};

fn snapshot(
    action: &crate::domain::models::ScheduledAction,
    description: &str,
) -> TemplateSnapshot {
    TemplateSnapshot {
        action_id: action.id.expect("created action has an id"),
        name: action.name.clone(),
        description: description.into(),
        trigger: action.trigger.clone(),
        task: json!({"model": "model", "prompt": "summarize", "user_prompt": "summarize"}),
        variables: vec![TemplateVariable::Item {
            id: "channel-1".into(),
            block_name: "channel".into(),
            label: "customer-success".into(),
            fill: VariableFill::Shared,
        }],
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resharing_replaces_the_snapshot_and_counts_activations(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let actions = test_repo(pool.clone());
    let templates = PgRoutineTemplateRepo::new(pool);
    let source = actions
        .create_action(sample_action(user_owner(USER_A), "digest"))
        .await
        .unwrap();
    let id = source.id.unwrap();

    let first = templates
        .upsert_template(snapshot(&source, "first"))
        .await
        .unwrap();
    assert_eq!(first.author, user_owner(USER_A));
    assert_eq!(first.active_count, 0);

    let mut activated = sample_action(user_owner(USER_B), "my digest");
    activated.template_id = Some(id);
    let activated = actions.create_action(activated).await.unwrap();
    assert_eq!(activated.template_id, Some(id));
    let reread = actions
        .get_action(&activated.id.unwrap())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(reread.template_id, Some(id));

    let second = templates
        .upsert_template(snapshot(&source, "second"))
        .await
        .unwrap();
    assert_eq!(second.description, "second");
    assert_eq!(second.created_at, first.created_at);
    assert_eq!(second.active_count, 1);
    assert_eq!(second.variables, first.variables);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn stopping_or_deleting_the_source_removes_the_template_only(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let actions = test_repo(pool.clone());
    let templates = PgRoutineTemplateRepo::new(pool);
    let source = actions
        .create_action(sample_action(user_owner(USER_A), "digest"))
        .await
        .unwrap();
    let id = source.id.unwrap();
    templates
        .upsert_template(snapshot(&source, "shared"))
        .await
        .unwrap();
    let mut activated = sample_action(user_owner(USER_B), "my digest");
    activated.template_id = Some(id);
    let activated = actions.create_action(activated).await.unwrap();

    templates.delete_template(&id).await.unwrap();
    templates.delete_template(&id).await.unwrap();
    assert!(templates.get_template(&id).await.unwrap().is_none());

    templates
        .upsert_template(snapshot(&source, "shared again"))
        .await
        .unwrap();
    actions.delete_action(&id).await.unwrap();
    assert!(templates.get_template(&id).await.unwrap().is_none());
    let kept = actions
        .get_action(&activated.id.unwrap())
        .await
        .unwrap()
        .expect("activated routines outlive their template");
    assert_eq!(kept.template_id, Some(id));
}
