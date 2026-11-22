//! Contract coverage for the property catalog mutations: how GraphQL input
//! becomes the REST request, how domain refusals become error codes, and the
//! cache-facing payloads of deletes, promotion and merge.

use std::sync::{Arc, Mutex};

use async_graphql::{EmptySubscription, Object, Schema};
use models_properties::{
    DataType, PropertyOwner,
    api::requests::SetPropertyValue,
    service::{
        entity_property_with_definition::EntityPropertyWithDefinition,
        property_definition::PropertyDefinition, property_option::PropertyOptionValue,
    },
};
use serde_json::{Value, json};

use super::*;
use crate::{
    NoOpEntityPropertyReader, NoOpEntityPropertyWriter, mutations::EntityPropertyOptionDelta,
};

const DEFINITION: Uuid = Uuid::from_u128(1);
const OPTION: Uuid = Uuid::from_u128(2);
const TARGET: Uuid = Uuid::from_u128(3);

/// What the fake writer was asked to do, with requests as JSON.
#[derive(Debug, PartialEq)]
enum Call {
    Create(Value),
    DeleteDefinition(Uuid),
    AddOption(Uuid, Option<Uuid>, Value),
    UpdateOption(Uuid, Uuid, Value),
    DeleteOption(Uuid, Uuid),
    EnsureTagSet(TagScope),
    Promote(Uuid),
    Merge(Uuid, Uuid),
}

fn to_json(value: &impl serde::Serialize) -> Value {
    serde_json::to_value(value).expect("request serializes")
}

/// Writer recording each catalog call and answering with `refusal` when set.
#[derive(Clone, Default)]
struct FakeWriter {
    calls: Arc<Mutex<Vec<Call>>>,
    refusal: Arc<Mutex<Option<PropertiesErr>>>,
}

impl FakeWriter {
    fn refusing(err: PropertiesErr) -> Self {
        let writer = Self::default();
        *writer.refusal.lock().expect("refusal") = Some(err);
        writer
    }

    fn record(&self, call: Call) -> Result<(), PropertiesErr> {
        self.calls.lock().expect("calls").push(call);
        match self.refusal.lock().expect("refusal").take() {
            Some(err) => Err(err),
            None => Ok(()),
        }
    }

    fn calls(&self) -> Vec<Call> {
        std::mem::take(&mut *self.calls.lock().expect("calls"))
    }
}

fn definition(data_type: DataType) -> PropertyDefinition {
    let now = chrono::Utc::now();
    PropertyDefinition {
        id: DEFINITION,
        owner: PropertyOwner::User {
            user_id: "macro|viewer@example.com".to_owned(),
        },
        display_name: "Stage".to_owned(),
        data_type,
        is_multi_select: false,
        specific_entity_type: None,
        created_at: now,
        updated_at: now,
        is_system: false,
        is_metadata: false,
    }
}

fn option(id: Uuid, value: &str) -> PropertyOption {
    let now = chrono::Utc::now();
    PropertyOption {
        id,
        property_definition_id: DEFINITION,
        display_order: 0,
        value: PropertyOptionValue::String(value.to_owned()),
        color: Some("#ff0000".to_owned()),
        created_at: now,
        updated_at: now,
    }
}

impl PropertyCatalogWriter for FakeWriter {
    async fn create_property_definition(
        &self,
        request: CreatePropertyDefinitionRequest,
    ) -> Result<PropertyDefinition, PropertiesErr> {
        self.record(Call::Create(to_json(&request)))?;
        let data_type = match request.data_type {
            PropertyDataType::SelectString { .. } => DataType::SelectString,
            _ => DataType::String,
        };
        Ok(definition(data_type))
    }

    async fn delete_property_definition(&self, id: Uuid) -> Result<(), PropertiesErr> {
        self.record(Call::DeleteDefinition(id))
    }

    async fn add_property_option(
        &self,
        id: Uuid,
        option_id: Option<Uuid>,
        request: AddPropertyOptionRequest,
    ) -> Result<PropertyOption, PropertiesErr> {
        self.record(Call::AddOption(id, option_id, to_json(&request)))?;
        Ok(option(option_id.unwrap_or(OPTION), "Lead"))
    }

    async fn update_property_option(
        &self,
        id: Uuid,
        option_id: Uuid,
        request: UpdatePropertyOptionRequest,
    ) -> Result<PropertyOption, PropertiesErr> {
        self.record(Call::UpdateOption(id, option_id, to_json(&request)))?;
        Ok(option(option_id, "Won"))
    }

    async fn delete_property_option(&self, id: Uuid, option_id: Uuid) -> Result<(), PropertiesErr> {
        self.record(Call::DeleteOption(id, option_id))
    }

    async fn ensure_tag_set(&self, scope: TagScope) -> Result<TagSet, PropertiesErr> {
        self.record(Call::EnsureTagSet(scope))?;
        Ok(TagSet {
            scope,
            definition: Some(definition(DataType::Tag)),
            options: vec![option(OPTION, "Urgent")],
        })
    }

    async fn promote_tag_option(&self, option_id: Uuid) -> Result<PropertyOption, PropertiesErr> {
        self.record(Call::Promote(option_id))?;
        Ok(option(option_id, "Urgent"))
    }

    async fn merge_tag_option(
        &self,
        option_id: Uuid,
        target: Uuid,
    ) -> Result<PropertyOption, PropertiesErr> {
        self.record(Call::Merge(option_id, target))?;
        Ok(option(target, "Urgent"))
    }
}

impl EntityPropertyWriter for FakeWriter {
    async fn delete_entity_property(
        &self,
        _entity_type: model_entity::EntityType,
        _entity_id: String,
        _entity_property_id: Uuid,
    ) -> Result<(), rootcause::Report> {
        unreachable!("catalog tests write no values")
    }

    async fn set_entity_property(
        &self,
        _entity_type: model_entity::EntityType,
        _entity_id: String,
        _property_definition_id: Uuid,
        _value: Option<SetPropertyValue>,
    ) -> Result<EntityPropertyWithDefinition, rootcause::Report> {
        unreachable!("catalog tests write no values")
    }

    async fn update_entity_property_options(
        &self,
        _entity_type: model_entity::EntityType,
        _entity_id: String,
        _updates: Vec<EntityPropertyOptionDelta>,
    ) -> Result<Vec<EntityPropertyWithDefinition>, rootcause::Report> {
        unreachable!("catalog tests write no values")
    }
}

struct Query;

#[Object]
impl Query {
    async fn health(&self) -> bool {
        true
    }
}

/// Run one mutation; answer its data and each error's message and code.
async fn run<W: EntityPropertyWriter>(writer: W, mutation: &str) -> (Value, Vec<Value>) {
    let schema = Schema::build(
        Query,
        PropertyCatalogMutationRoot::<W, NoOpEntityPropertyReader>::new(),
        EmptySubscription,
    )
    .data(writer)
    .finish();
    let response = schema.execute(mutation).await;
    let errors = response
        .errors
        .iter()
        .map(|err| {
            let code = err
                .extensions
                .as_ref()
                .and_then(|ext| ext.get("code"))
                .map(|code| code.clone().into_json().expect("code json"));
            json!({ "message": err.message, "code": code })
        })
        .collect();
    (response.data.into_json().expect("data is json"), errors)
}

#[tokio::test]
async fn create_maps_a_select_definition_to_the_rest_request() {
    let writer = FakeWriter::default();
    let (data, errors) = run(
        writer.clone(),
        r#"mutation { createPropertyDefinition(input: {
            scope: TEAM, displayName: "Stage", dataType: SELECT_STRING,
            isMultiSelect: true,
            options: [{ displayOrder: 0, value: { string: "Lead" } }]
        }) { id dataType } }"#,
    )
    .await;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["createPropertyDefinition"],
        json!({ "id": DEFINITION.to_string(), "dataType": "SELECT_STRING" })
    );
    assert_eq!(
        writer.calls(),
        [Call::Create(to_json(&CreatePropertyDefinitionRequest {
            scope: CreatePropertyScope::Team,
            display_name: "Stage".to_owned(),
            data_type: PropertyDataType::SelectString {
                options: vec![SelectStringOption {
                    display_order: 0,
                    value: "Lead".to_owned(),
                }],
                multi: true,
            },
        }))]
    );
}

#[tokio::test]
async fn create_maps_an_entity_definition_with_its_type() {
    let writer = FakeWriter::default();
    let (_, errors) = run(
        writer.clone(),
        r#"mutation { createPropertyDefinition(input: {
            scope: USER, displayName: "Owner", dataType: ENTITY, specificEntityType: USER
        }) { id } }"#,
    )
    .await;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        writer.calls(),
        [Call::Create(to_json(&CreatePropertyDefinitionRequest {
            scope: CreatePropertyScope::User,
            display_name: "Owner".to_owned(),
            data_type: PropertyDataType::Entity {
                specific_type: Some(models_properties::EntityType::User),
                multi: false,
            },
        }))]
    );
}

#[tokio::test]
async fn create_refuses_malformed_input_before_the_writer() {
    for input in [
        r#"scope: USER, displayName: "T", dataType: TAG"#,
        r#"scope: USER, displayName: "S", dataType: STRING, options: [{ displayOrder: 0, value: { string: "x" } }]"#,
        r#"scope: USER, displayName: "S", dataType: STRING, isMultiSelect: true"#,
        r#"scope: USER, displayName: "S", dataType: LINK, specificEntityType: TASK"#,
        r#"scope: USER, displayName: "N", dataType: SELECT_NUMBER, options: [{ displayOrder: 0, value: { string: "x" } }]"#,
        r#"scope: USER, displayName: "N", dataType: SELECT_STRING, options: [{ displayOrder: 0, value: { number: 1 } }]"#,
    ] {
        let writer = FakeWriter::default();
        let (_, errors) = run(
            writer.clone(),
            &format!("mutation {{ createPropertyDefinition(input: {{ {input} }}) {{ id }} }}"),
        )
        .await;
        assert_eq!(errors.len(), 1, "{input}");
        assert_eq!(errors[0]["code"], json!("BAD_REQUEST"), "{input}");
        assert!(writer.calls().is_empty(), "{input}");
    }
}

#[tokio::test]
async fn option_writes_carry_the_definition_and_option_ids() {
    let writer = FakeWriter::default();
    for mutation in [
        format!(
            r##"mutation {{ addPropertyOption(input: {{ propertyDefinitionId: "{DEFINITION}", displayOrder: 2, value: {{ string: "Lead" }}, color: "#ff0000" }}) {{ id }} }}"##
        ),
        format!(
            r#"mutation {{ updatePropertyOption(input: {{ propertyDefinitionId: "{DEFINITION}", optionId: "{OPTION}", value: "Won" }}) {{ id }} }}"#
        ),
    ] {
        let (_, errors) = run(writer.clone(), &mutation).await;
        assert!(errors.is_empty(), "{errors:?}");
    }
    let (removed, errors) = run(
        writer.clone(),
        &format!(
            r#"mutation {{ deletePropertyOption(propertyDefinitionId: "{DEFINITION}", optionId: "{OPTION}") {{ graphqlTypeName entityId }} }}"#
        ),
    )
    .await;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        removed["deletePropertyOption"],
        json!({ "graphqlTypeName": "GraphqlPropertyOption", "entityId": OPTION.to_string() })
    );
    let (dropped, errors) = run(
        writer.clone(),
        &format!(
            r#"mutation {{ deletePropertyDefinition(propertyDefinitionId: "{DEFINITION}") {{ graphqlTypeName entityId }} }}"#
        ),
    )
    .await;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        dropped["deletePropertyDefinition"],
        json!({ "graphqlTypeName": "GraphqlPropertyDefinition", "entityId": DEFINITION.to_string() })
    );
    assert_eq!(
        writer.calls(),
        [
            Call::AddOption(
                DEFINITION,
                None,
                to_json(&AddPropertyOptionRequest::SelectString {
                    option: AddStringOptionRequest {
                        display_order: 2,
                        value: "Lead".to_owned(),
                        color: Some("#ff0000".to_owned()),
                    },
                })
            ),
            Call::UpdateOption(
                DEFINITION,
                OPTION,
                to_json(&UpdatePropertyOptionRequest {
                    value: Some("Won".to_owned()),
                    color: None,
                    display_order: None,
                })
            ),
            Call::DeleteOption(DEFINITION, OPTION),
            Call::DeleteDefinition(DEFINITION),
        ]
    );
}

#[tokio::test]
async fn an_add_with_a_client_id_creates_the_option_under_it() {
    let writer = FakeWriter::default();
    let (data, errors) = run(
        writer.clone(),
        &format!(
            r#"mutation {{ addPropertyOption(input: {{ id: "{TARGET}", propertyDefinitionId: "{DEFINITION}", displayOrder: 0, value: {{ string: "Lead" }} }}) {{ id }} }}"#
        ),
    )
    .await;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["addPropertyOption"],
        json!({ "id": TARGET.to_string() })
    );
    assert!(matches!(
        writer.calls().as_slice(),
        [Call::AddOption(DEFINITION, Some(TARGET), _)]
    ));
}

#[tokio::test]
async fn one_operation_runs_at_most_one_catalog_write() {
    let delete =
        format!(r#"deletePropertyDefinition(propertyDefinitionId: "{DEFINITION}") {{ entityId }}"#);
    for mutation in [
        format!("mutation {{ a: {delete} b: {delete} }}"),
        format!(
            r#"mutation {{ a: {delete} ...more }} fragment more on PropertyCatalogMutationRoot {{ ensureTagSet(scope: USER) {{ scope }} }}"#
        ),
        format!("mutation {{ a: {delete} ... on PropertyCatalogMutationRoot {{ b: {delete} }} }}"),
    ] {
        let writer = FakeWriter::default();
        let (_, errors) = run(writer.clone(), &mutation).await;
        assert!(!errors.is_empty(), "{mutation}");
        assert!(
            errors.iter().all(|err| err["code"] == json!("BAD_REQUEST")),
            "{errors:?}"
        );
        assert!(writer.calls().is_empty(), "{mutation}");
    }
}

#[tokio::test]
async fn a_malformed_id_is_a_bad_request_that_does_not_echo_it() {
    let writer = FakeWriter::default();
    let (_, errors) = run(
        writer.clone(),
        r#"mutation { deletePropertyOption(propertyDefinitionId: "macro|someone@example.com", optionId: "x") { entityId } }"#,
    )
    .await;
    assert_eq!(
        errors,
        [json!({ "message": "`propertyDefinitionId` is not a valid id", "code": "BAD_REQUEST" })]
    );
    assert!(writer.calls().is_empty());
}

#[tokio::test]
async fn deletion_markers_name_the_canonical_id() {
    let upper = DEFINITION.to_string().to_uppercase();
    let (data, errors) = run(
        FakeWriter::default(),
        &format!(
            r#"mutation {{ deletePropertyDefinition(propertyDefinitionId: "{upper}") {{ entityId }} }}"#
        ),
    )
    .await;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["deletePropertyDefinition"]["entityId"],
        json!(DEFINITION.to_string())
    );
}

#[tokio::test]
async fn a_number_option_takes_no_color() {
    let writer = FakeWriter::default();
    let (_, errors) = run(
        writer.clone(),
        &format!(
            r##"mutation {{ addPropertyOption(input: {{ propertyDefinitionId: "{DEFINITION}", displayOrder: 0, value: {{ number: 3 }}, color: "#ff0000" }}) {{ id }} }}"##
        ),
    )
    .await;
    assert_eq!(errors[0]["code"], json!("BAD_REQUEST"));
    assert!(writer.calls().is_empty());
}

#[tokio::test]
async fn refusals_carry_their_rest_status_class() {
    for (err, code) in [
        (
            PropertiesErr::Validation("bad color".to_owned()),
            "BAD_REQUEST",
        ),
        (PropertiesErr::NotFound, "NOT_FOUND"),
        (PropertiesErr::OptionNotFound, "NOT_FOUND"),
        (PropertiesErr::DuplicateOptionValue, "CONFLICT"),
        (PropertiesErr::ReservedName("Tags"), "CONFLICT"),
        (PropertiesErr::PermissionDenied, "FORBIDDEN"),
        (PropertiesErr::ManagedDefinition, "FORBIDDEN"),
        (PropertiesErr::TeamMembershipRequired, "FORBIDDEN"),
        (PropertiesErr::SystemPropertyNotModifiable, "FORBIDDEN"),
    ] {
        let message = err.to_string();
        let (_, errors) = run(
            FakeWriter::refusing(err),
            &format!(
                r#"mutation {{ deletePropertyDefinition(propertyDefinitionId: "{DEFINITION}") {{ entityId }} }}"#
            ),
        )
        .await;
        assert_eq!(errors, [json!({ "message": message, "code": code })]);
    }
}

#[tokio::test]
async fn an_infrastructure_failure_hides_its_cause() {
    let (_, errors) = run(
        FakeWriter::refusing(PropertiesErr::Repo(anyhow::anyhow!(
            "connection to 10.0.0.1 refused"
        ))),
        r#"mutation { ensureTagSet(scope: TEAM) { scope } }"#,
    )
    .await;
    assert_eq!(
        errors,
        [json!({ "message": "property catalog write failed", "code": "INTERNAL" })]
    );
}

#[tokio::test]
async fn ensure_tag_set_returns_the_provisioned_set() {
    let writer = FakeWriter::default();
    let (data, errors) = run(
        writer.clone(),
        r#"mutation { ensureTagSet(scope: TEAM) { scope definition { id } options { id } } }"#,
    )
    .await;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["ensureTagSet"],
        json!({
            "scope": "TEAM",
            "definition": { "id": DEFINITION.to_string() },
            "options": [{ "id": OPTION.to_string() }],
        })
    );
    assert_eq!(writer.calls(), [Call::EnsureTagSet(TagScope::Team)]);
}

const PROMOTE: &str = r#"mutation { promoteTag(optionId: "00000000-0000-0000-0000-000000000002") {
    __typename
    ... on GraphqlPromotedTag { option { id } }
    ... on GraphqlTagPromotionConflict { message conflictingOption { id } }
} }"#;

#[tokio::test]
async fn promote_answers_with_the_moved_label() {
    let writer = FakeWriter::default();
    let (data, errors) = run(writer.clone(), PROMOTE).await;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["promoteTag"],
        json!({ "__typename": "GraphqlPromotedTag", "option": { "id": OPTION.to_string() } })
    );
    assert_eq!(writer.calls(), [Call::Promote(OPTION)]);
}

#[tokio::test]
async fn promote_answers_a_name_conflict_with_the_team_label() {
    let conflict = PropertiesErr::ConflictingTeamLabel(Box::new(option(TARGET, "Urgent")));
    let (data, errors) = run(FakeWriter::refusing(conflict), PROMOTE).await;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["promoteTag"],
        json!({
            "__typename": "GraphqlTagPromotionConflict",
            "message": "A team label with that name already exists",
            "conflictingOption": { "id": TARGET.to_string() },
        })
    );
}

#[tokio::test]
async fn merge_answers_with_the_team_label_and_the_removed_record() {
    let writer = FakeWriter::default();
    let (data, errors) = run(
        writer.clone(),
        &format!(
            r#"mutation {{ mergeTag(optionId: "{OPTION}", targetOptionId: "{TARGET}") {{
                option {{ id }} removedOption {{ graphqlTypeName entityId }}
            }} }}"#
        ),
    )
    .await;
    assert!(errors.is_empty(), "{errors:?}");
    assert_eq!(
        data["mergeTag"],
        json!({
            "option": { "id": TARGET.to_string() },
            "removedOption": { "graphqlTypeName": "GraphqlPropertyOption", "entityId": OPTION.to_string() },
        })
    );
    assert_eq!(writer.calls(), [Call::Merge(OPTION, TARGET)]);
}

#[tokio::test]
async fn a_writer_without_catalog_support_refuses() {
    let (_, errors) = run(
        NoOpEntityPropertyWriter,
        r#"mutation { ensureTagSet(scope: USER) { scope } }"#,
    )
    .await;
    assert_eq!(
        errors,
        [json!({ "message": "property catalog write failed", "code": "INTERNAL" })]
    );
}
