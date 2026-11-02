use super::*;
use item_filters::ast::properties::EntityRefId;

fn project_reference(project: Uuid) -> Expr<PropertiesLiteral> {
    Expr::val(PropertiesLiteral {
        property_definition_id: SystemPropertyKey::PROJECT_UUID,
        entity_type: None,
        value: PropertyMatchValue::EntityRef(EntityRefId::new(project.to_string()).unwrap()),
    })
}

fn status(option: Uuid) -> Expr<PropertiesLiteral> {
    Expr::val(PropertiesLiteral {
        property_definition_id: SystemPropertyKey::STATUS_UUID,
        entity_type: None,
        value: PropertyMatchValue::SelectOption(option),
    })
}

fn filter(tree: Expr<PropertiesLiteral>) -> EntityFilterAst {
    EntityFilterAst {
        properties_filter: Some(Arc::new(tree)),
        ..EntityFilterAst::default()
    }
}

#[test]
fn a_project_every_match_must_belong_to_is_required() {
    let project = Uuid::new_v4();
    assert_eq!(
        required_project(&filter(project_reference(project))),
        Some(project)
    );
    assert_eq!(
        required_project(&filter(Expr::and(
            status(Uuid::new_v4()),
            project_reference(project)
        ))),
        Some(project),
        "other facets narrow the project's tasks further"
    );
}

#[test]
fn a_project_offered_as_an_alternative_is_not_required() {
    let project = Uuid::new_v4();
    for tree in [
        Expr::or(project_reference(project), status(Uuid::new_v4())),
        Expr::is_not(project_reference(project)),
        Expr::and(
            project_reference(project),
            project_reference(Uuid::new_v4()),
        ),
        status(Uuid::new_v4()),
    ] {
        assert_eq!(required_project(&filter(tree)), None);
    }
    assert_eq!(required_project(&EntityFilterAst::default()), None);
}

#[test]
fn clients_cannot_mark_a_project_viewable() {
    let ast: EntityFilterAst = serde_json::from_value(serde_json::json!({
        "viewable_project": Uuid::new_v4(),
    }))
    .unwrap();
    assert_eq!(ast.viewable_project, None);
}
