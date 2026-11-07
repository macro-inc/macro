//! Outcome and per-amount currency through the pipeline workflows.

use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn outcomes_persist_and_mixed_currency_totals_stay_separate(pool: PgPool) {
    let Fixture {
        workflows,
        acme,
        globex,
        ..
    } = fixture(&pool).await;
    let owner = viewer(OWNER);
    let sales = sales(&workflows, PipelineSharing::Team).await;
    let id = sales.pipeline.pipeline.id;
    let added = workflows
        .add(
            &owner,
            id,
            vec![
                EntryAddition {
                    record: Some(RecordTarget::Id(acme)),
                    set: vec![
                        set("Revenue", "100"),
                        set("Outcome", "Won"),
                        set("Revenue currency", "EUR"),
                    ],
                },
                EntryAddition {
                    record: Some(RecordTarget::Id(globex)),
                    set: vec![set("Revenue", "200")],
                },
            ],
            false,
        )
        .await
        .unwrap();
    assert_eq!(field(&added.added[1], "Outcome"), labels("Open").as_ref());
    assert_eq!(
        added.added[0].currencies.get("Revenue").map(String::as_str),
        Some("EUR")
    );
    assert_eq!(
        field(&added.added[1], "Revenue currency"),
        labels("USD").as_ref()
    );
    let all = workflows
        .find(
            &owner,
            id,
            EntryQuery {
                limit: 50,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(
        all.totals,
        [
            crm::domain::pipeline_workflows::FieldTotal {
                field: "Revenue".into(),
                currency: Some("EUR".into()),
                sum: 100.0
            },
            crm::domain::pipeline_workflows::FieldTotal {
                field: "Revenue".into(),
                currency: Some("USD".into()),
                sum: 200.0
            },
        ]
    );
    let won = workflows
        .find(
            &owner,
            id,
            EntryQuery {
                filters: vec![set("Outcome", "Won")],
                limit: 50,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(won.entries.len(), 1);
    assert_eq!(won.entries[0].entry_id, added.added[0].entry_id);
    workflows
        .update(
            &owner,
            id,
            vec![EntryUpdate {
                target: EntryTarget::Entry(added.added[0].entry_id),
                set: vec![set("Outcome", "Lost")],
            }],
            None,
        )
        .await
        .unwrap();
    let lost = workflows
        .find(
            &owner,
            id,
            EntryQuery {
                filters: vec![set("Outcome", "Lost")],
                limit: 50,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(lost.entries[0].entry_id, added.added[0].entry_id);
    assert_eq!(
        field(&lost.entries[0], "Revenue currency"),
        labels("EUR").as_ref()
    );
    assert!(
        workflows
            .edit(
                &owner,
                id,
                PipelineEdit {
                    rename_options: vec![("Outcome".into(), "Won".into(), "Maybe".into())],
                    ..Default::default()
                }
            )
            .await
            .is_err()
    );
    assert!(
        workflows
            .update(
                &owner,
                id,
                vec![EntryUpdate {
                    target: EntryTarget::Entry(added.added[0].entry_id),
                    set: vec![("Revenue currency".into(), FieldInput::Clear)]
                }],
                None
            )
            .await
            .is_err()
    );
    let renamed = workflows
        .edit(
            &owner,
            id,
            PipelineEdit {
                rename_fields: vec![("Revenue".into(), "Contract value".into())],
                ..Default::default()
            },
        )
        .await
        .unwrap();
    assert_eq!(
        renamed.field("Contract value").unwrap().id,
        all.pipeline.field("Revenue").unwrap().id
    );
    #[cfg(feature = "ai_tools")]
    {
        let tool = crm::inbound::toolset::pipelines::ToolPipeline::from(&renamed);
        let field = |name: &str| tool.fields.iter().find(|field| field.name == name).unwrap();
        assert_eq!(
            field("Contract value").currency_field.as_deref(),
            Some("Revenue currency")
        );
        assert!(field("Outcome").required);
        assert!(field("Revenue currency").required);
    }
    let changed = workflows
        .update(
            &owner,
            id,
            vec![EntryUpdate {
                target: EntryTarget::Entry(added.added[0].entry_id),
                set: vec![set("Contract value", "250"), set("Revenue currency", "USD")],
            }],
            None,
        )
        .await
        .unwrap();
    let amount = changed.updated[0]
        .changes
        .iter()
        .find(|change| change.field == "Contract value")
        .unwrap();
    assert_eq!(amount.before_currency.as_deref(), Some("EUR"));
    assert_eq!(amount.after_currency.as_deref(), Some("USD"));
    let reloaded = workflows
        .find(
            &owner,
            id,
            EntryQuery {
                limit: 50,
                ..Default::default()
            },
        )
        .await
        .unwrap();
    let entry = reloaded
        .entries
        .iter()
        .find(|entry| entry.entry_id == added.added[0].entry_id)
        .unwrap();
    assert_eq!(
        entry.currencies.get("Contract value").map(String::as_str),
        Some("USD")
    );
    #[cfg(feature = "ai_tools")]
    assert_eq!(
        crm::inbound::toolset::pipelines::ToolEntry::from(entry).currencies,
        entry.currencies
    );
}
