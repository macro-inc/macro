use super::*;
use databases::domain::templates::TEMPLATES;

#[tokio::test]
async fn template_creation_preserves_the_template_owner_and_actor() {
    for template in TEMPLATES {
        let world = world();
        let result = sql(&world)
            .execute(
                agent_for(OWNER),
                SqlRequest {
                    sql: format!("CREATE DATABASE \"Launch plan\" TEMPLATE {}", template.id),
                    scope: None,
                    base_versions: HashMap::new(),
                },
            )
            .await
            .unwrap();
        assert!(matches!(result.statement, SqlStatement::Schema { .. }));
        let world = world.lock().unwrap();
        assert_eq!(world.created.len(), 1);
        let created = &world.created[0];
        assert_eq!(created.name, "Launch plan");
        assert_eq!(created.template, Some(template.id));
        assert_eq!(created.owner_id, agent_for(OWNER).user_id);
        assert_eq!(created.acting_bot, agent_for(OWNER).acting_bot);
    }
}

#[tokio::test]
async fn unknown_and_removed_templates_are_refused_before_creation() {
    for template in ["crm", "unknown_template"] {
        let world = world();
        let error = sql(&world)
            .execute(
                agent_for(OWNER),
                SqlRequest {
                    sql: format!("CREATE DATABASE Launch TEMPLATE {template}"),
                    scope: None,
                    base_versions: HashMap::new(),
                },
            )
            .await
            .unwrap_err();
        assert!(matches!(
            error,
            SqlError::WriteRefused { reason, .. }
                if reason.contains("Unknown database template")
                    && reason.contains("project_tracker")
        ));
        assert!(world.lock().unwrap().created.is_empty());
    }
}

#[tokio::test]
async fn read_only_hosts_refuse_template_creation() {
    let world = world();
    let error = sql(&world)
        .view_only()
        .execute(
            agent_for(OWNER),
            SqlRequest {
                sql: "CREATE DATABASE Launch TEMPLATE project_tracker".into(),
                scope: None,
                base_versions: HashMap::new(),
            },
        )
        .await
        .unwrap_err();
    assert!(matches!(
        error,
        SqlError::WriteRefused { reason, .. } if reason.contains("read-only")
    ));
    assert!(world.lock().unwrap().created.is_empty());
}
