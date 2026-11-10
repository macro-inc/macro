use super::*;
use crate::plugins_group_b::checklist_controls::ChecklistItemMeta;
use lexical_model::KeyParts;
use serde_json::json;
use sha2::{Digest, Sha256};

fn key(value: &Value) -> NodeKey {
    NodeKey::from_parts(KeyParts {
        index: value
            .as_str()
            .expect("plain fixture key")
            .parse()
            .expect("numeric key label"),
        generation: 0,
    })
}
fn maybe(value: Option<&Value>) -> Maybe<String> {
    match value {
        None => Maybe::Missing,
        Some(Value::Null) => Maybe::Null,
        Some(value) => Maybe::Value(value.as_str().expect("string fact").to_owned()),
    }
}
fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .expect("array")
        .iter()
        .map(|value| value.as_str().expect("string").to_owned())
        .collect()
}
fn priority_fact(value: &Value) -> Option<TaskPriority> {
    match value.as_str() {
        None => None,
        Some("urgent") => Some(TaskPriority::Urgent),
        Some("high") => Some(TaskPriority::High),
        Some("medium") => Some(TaskPriority::Medium),
        Some("low") => Some(TaskPriority::Low),
        _ => panic!("priority fixture"),
    }
}
fn metadata(value: &Value) -> Option<ChecklistMeta> {
    if value.is_null() {
        return None;
    }
    Some(ChecklistMeta {
        list_key: key(&value["listKey"]),
        settings: Arc::new(value["settings"].clone()),
        items: value["items"]
            .as_array()
            .expect("items")
            .iter()
            .map(|item| ChecklistItemMeta {
                key: key(&item["key"]),
                leading_keys: item["leadingKeys"]
                    .as_array()
                    .expect("leading")
                    .iter()
                    .map(key)
                    .collect(),
                attached_keys: item["attachedKeys"]
                    .as_array()
                    .expect("attached")
                    .iter()
                    .map(key)
                    .collect(),
                checked: item["checked"].as_bool().expect("checked"),
                text: item["text"].as_str().expect("text").into(),
                mention_assignees: item["mentionAssignees"]
                    .as_array()
                    .expect("assignees")
                    .iter()
                    .map(|assignee| ChecklistAssignee {
                        id: maybe(assignee.get("id")),
                        name: assignee["name"].as_str().expect("name").into(),
                    })
                    .collect(),
                mention_due: maybe(item.get("mentionDue")),
                marker_priority: priority_fact(&item["markerPriority"]),
                task_id: maybe(item.get("taskId")),
            })
            .collect(),
    })
}
fn civil(value: &Value) -> CivilDateTime {
    CivilDateTime {
        date: CivilDate {
            year: i32::try_from(value["date"]["year"].as_i64().expect("year")).expect("year range"),
            month: u8::try_from(value["date"]["month"].as_u64().expect("month"))
                .expect("month range"),
            day: u8::try_from(value["date"]["day"].as_u64().expect("day")).expect("day range"),
        },
        hour: u8::try_from(value["hour"].as_u64().expect("hour")).expect("hour range"),
        minute: u8::try_from(value["minute"].as_u64().expect("minute")).expect("minute range"),
        second: u8::try_from(value["second"].as_u64().expect("second")).expect("second range"),
        millisecond: u16::try_from(value["millisecond"].as_u64().expect("millisecond"))
            .expect("millisecond range"),
    }
}
fn observed(value: &Value) -> DateObservation {
    DateObservation {
        instant_ms: value["instantMs"].as_i64().expect("actual instant"),
        local: civil(&value["local"]),
        start_of_day: match value["startOfDay"].get("valid") {
            Some(midnight) => NormalizedMidnight::Valid {
                instant_ms: midnight["instantMs"].as_i64().expect("midnight instant"),
                local: civil(&midnight["local"]),
            },
            None => {
                assert_eq!(value["startOfDay"]["invalid"], true);
                NormalizedMidnight::Invalid
            }
        },
    }
}
fn calendar(value: &Value) -> ChecklistCalendar {
    ChecklistCalendar {
        today: observed(&value["today"]),
        due_dates: value["dueDates"]
            .as_object()
            .expect("date facts")
            .iter()
            .map(|(due, fact)| {
                (
                    due.clone(),
                    match fact.get("valid") {
                        Some(value) => ParsedDueDate::Valid(observed(value)),
                        None => {
                            assert_eq!(fact["invalid"], true);
                            ParsedDueDate::Invalid
                        }
                    },
                )
            })
            .collect(),
    }
}
fn tasks(value: &Value) -> BTreeMap<String, TaskInfo> {
    value
        .as_object()
        .expect("real task facts")
        .iter()
        .map(|(id, task)| {
            (
                id.clone(),
                TaskInfo {
                    status_option_id: task["statusOptionId"].as_str().map(str::to_owned),
                    priority_option_id: task["priorityOptionId"].as_str().map(str::to_owned),
                    assignee_ids: strings(&task["assigneeIds"]),
                    due: task["due"].as_str().map(str::to_owned),
                },
            )
        })
        .collect()
}
fn names(value: &Value) -> BTreeMap<String, String> {
    value
        .as_object()
        .expect("names")
        .iter()
        .map(|(id, name)| (id.clone(), name.as_str().expect("name").to_owned()))
        .collect()
}
fn encoded_maybe(value: &Maybe<String>) -> Value {
    match value {
        Maybe::Missing => json!({"undefined":true}),
        Maybe::Null => Value::Null,
        Maybe::Value(value) => json!(value),
    }
}
fn encoded(plan: &ChecklistPlan) -> Value {
    json!({
        "settings": {"filters": {"status":plan.settings.filters.status,"priority":plan.settings.filters.priority,"assignees":plan.settings.filters.assignees,"due":plan.settings.filters.due}},
        "items": plan.items.iter().map(|item| json!({
            "key":item.key.index().to_string(),
            "leadingKeys":item.leading_keys.iter().map(|key|key.index().to_string()).collect::<Vec<_>>(),
            "attachedKeys":item.attached_keys.iter().map(|key|key.index().to_string()).collect::<Vec<_>>(),
            "text":item.text,"checked":item.checked,"status":item.status.as_str(),
            "priority":item.priority.as_ref().map(AsRef::<str>::as_ref),
            "assignees":item.assignees.iter().map(|assignee|json!({"id":encoded_maybe(&assignee.id),"name":assignee.name})).collect::<Vec<_>>(),
            "due":encoded_maybe(&item.due),
        })).collect::<Vec<_>>(),
        "plan": {"rows":plan.rows.iter().map(|row|json!({"key":row.key.index().to_string(),"dimmed":row.dimmed})).collect::<Vec<_>>(),"active":plan.active,"progress":{"done":plan.progress.done,"total":plan.progress.total}},
        "filterCount":{"number":plan.filter_count},
        "hasTasks":plan.has_tasks,
        "progressPct":format!("{}%",plan.progress.percentage()),
    })
}
fn source_outputs() -> Vec<Value> {
    [
        include_str!("source-utc.json"),
        include_str!("source-new-york.json"),
        include_str!("source-prague.json"),
        include_str!("source-kiritimati.json"),
    ]
    .iter()
    .map(|source| serde_json::from_str(source).expect("Source output"))
    .collect()
}

#[test]
fn unchanged_source_outputs_match_for_utc_new_york_and_historical_prague() {
    let mut supported = 0;
    let mut unsupported = 0;
    for source in source_outputs() {
        assert_eq!(
            source["inputSha256"],
            format!("{:x}", Sha256::digest(include_bytes!("source-inputs.json")))
        );
        assert_eq!(
            source["sourceCommit"],
            "34959817b73c6d30e1b768320120f77865dcd352"
        );
        assert_eq!(
            source["modelSha256"],
            "201bb633173f84fe6436c132043f17e78b49fceb8b146e1a0c4f0bbc8ff8b3d3"
        );
        for row in source["rows"].as_array().expect("rows") {
            let input = &row["input"];
            let meta = metadata(&input["meta"]);
            let facts = if input["name"]
                .as_str()
                .expect("name")
                .starts_with("unsupported-")
            {
                // Unsupported settings are rejected before touching calendar observations.
                calendar(&source["rows"][0]["calendar"])
            } else {
                calendar(&row["calendar"])
            };
            let result = plan_checklist(
                meta.as_ref(),
                &tasks(&input["tasks"]),
                &names(&input["names"]),
                &facts,
            );
            if input["name"]
                .as_str()
                .expect("name")
                .starts_with("unsupported-")
            {
                let ChecklistPlanResult::UnsupportedInput { raw, .. } = result else {
                    panic!(
                        "noncanonical coverage gap must be explicit: {:?}",
                        input["name"]
                    );
                };
                assert!(Arc::ptr_eq(
                    &raw,
                    &meta.as_ref().expect("raw meta").settings
                ));
                assert_eq!(*raw, input["meta"]["settings"]);
                unsupported += 1;
            } else {
                let ChecklistPlanResult::Planned(plan) = result else {
                    panic!("supported input {:?}: {result:?}", input["name"]);
                };
                assert_eq!(
                    encoded(&plan),
                    row["source"],
                    "{} / {}",
                    source["timezone"],
                    input["name"]
                );
                supported += 1;
            }
        }
    }
    assert_eq!((supported, unsupported), (136, 60));
}

#[test]
fn supported_short_circuit_does_not_demand_unobserved_due_dates() {
    let source = &source_outputs()[0];
    let mut meta = metadata(&source["rows"][2]["input"]["meta"]).expect("metadata");
    meta.items.truncate(1);
    meta.items[0].mention_due = Maybe::Value("must not be parsed".into());
    meta.settings = Arc::new(json!({"filters":{"status":["done"],"due":["week"]}}));
    let facts = calendar(&source["rows"][0]["calendar"]);
    let ChecklistPlanResult::Planned(plan) =
        plan_checklist(Some(&meta), &BTreeMap::new(), &BTreeMap::new(), &facts)
    else {
        panic!("status rejects before date lookup");
    };
    assert!(plan.rows.iter().all(|row| row.dimmed));
    meta.settings = Arc::new(json!({"filters":{"due":["week"]}}));
    assert!(
        matches!(plan_checklist(Some(&meta),&BTreeMap::new(),&BTreeMap::new(),&facts),ChecklistPlanResult::InvalidCalendarFacts(CalendarProblem::MissingDueObservation(value)) if value=="must not be parsed")
    );
}

#[test]
fn invalid_raw_calendar_representations_are_not_source_invalid_midnight_semantics() {
    let source = &source_outputs()[0];
    let mut facts = calendar(&source["rows"][0]["calendar"]);
    facts.today.instant_ms = i64::MIN;
    assert!(matches!(
        plan_checklist(None, &BTreeMap::new(), &BTreeMap::new(), &facts),
        ChecklistPlanResult::InvalidCalendarFacts(CalendarProblem::InvalidInstant(i64::MIN))
    ));
    facts = calendar(&source["rows"][0]["calendar"]);
    facts.today.local.date = CivilDate {
        year: 2030,
        month: 2,
        day: 29,
    };
    assert!(matches!(
        plan_checklist(None, &BTreeMap::new(), &BTreeMap::new(), &facts),
        ChecklistPlanResult::InvalidCalendarFacts(CalendarProblem::InvalidCivilDate(_))
    ));
    facts = calendar(&source["rows"][0]["calendar"]);
    facts.today.local.second = 60;
    assert!(matches!(
        plan_checklist(None, &BTreeMap::new(), &BTreeMap::new(), &facts),
        ChecklistPlanResult::InvalidCalendarFacts(CalendarProblem::InvalidLocalTime(_))
    ));
}

#[test]
fn actual_minimum_date_midnight_failure_and_year_zero_constructor_rollover_are_supported() {
    let source = &source_outputs()[1];
    let rows = source["rows"].as_array().expect("rows");
    for name in [
        "js-minimum-year",
        "year-zero-leap-rollover",
        "year-zero-week-boundary",
        "year-zero-reverse-rollover",
    ] {
        let row = rows
            .iter()
            .find(|row| row["input"]["name"] == name)
            .expect("range case");
        let facts = calendar(&row["calendar"]);
        let meta = metadata(&row["input"]["meta"]).expect("meta");
        let ChecklistPlanResult::Planned(plan) =
            plan_checklist(Some(&meta), &BTreeMap::new(), &BTreeMap::new(), &facts)
        else {
            panic!("supported source date behavior");
        };
        assert_eq!(encoded(&plan), row["source"]);
    }
    let min = rows
        .iter()
        .find(|row| row["input"]["name"] == "js-minimum-year")
        .expect("minimum");
    assert!(matches!(
        calendar(&min["calendar"]).today.start_of_day,
        NormalizedMidnight::Invalid
    ));
}

#[test]
fn historical_offset_seconds_are_not_truncated_and_count_ratios_round_like_source() {
    let source = &source_outputs()[2];
    let row = source["rows"]
        .as_array()
        .expect("rows")
        .iter()
        .find(|row| row["input"]["name"] == "historical-offset-seconds")
        .expect("historical case");
    let date = calendar(&row["calendar"]).today;
    let NormalizedMidnight::Valid { instant_ms, local } = date.start_of_day else {
        panic!("valid historical midnight");
    };
    let utc = source_utc_time(local)
        .expect("valid representation")
        .expect("UTC reconstruction");
    assert_eq!(instant_ms - utc, -3_464_000);
    assert_eq!(ChecklistProgress { done: 1, total: 8 }.percentage(), 13.0);
    assert_eq!(ChecklistProgress { done: 1, total: 3 }.percentage(), 33.0);
    assert_eq!(ChecklistProgress::default().completion_ratio(), 0.0);
    assert_eq!(ChecklistProgress::default().percentage(), 0.0);
}

#[test]
fn utc_constructor_year_normalization_and_invalid_date_revival_match_actual_source_helper() {
    let mut revived = false;
    for source in source_outputs() {
        for row in source["rows"].as_array().expect("rows") {
            let Some(calendar_value) = row.get("calendar") else {
                continue;
            };
            let date = calendar(calendar_value).today;
            let offset = source_utc_time(date.local)
                .expect("valid date representation")
                .map(|utc| date.instant_ms as f64 - utc as f64);
            let expected = &row["calendarDiagnostics"]["originalOffset"];
            match offset {
                Some(offset) => assert_eq!(
                    offset,
                    expected["number"].as_f64().expect("actual Source offset"),
                    "{} / {}",
                    source["timezone"],
                    row["input"]["name"]
                ),
                None => assert_eq!(expected["nan"], true),
            }
            let facts = calendar(calendar_value);
            for (due, parsed) in &facts.due_dates {
                if let ParsedDueDate::Valid(date) = parsed {
                    let expected = &row["calendarDiagnostics"]["dueOffsets"][due];
                    match source_utc_time(date.local).expect("valid local representation") {
                        Some(utc) => assert_eq!(
                            date.instant_ms as f64 - utc as f64,
                            expected["number"].as_f64().expect("Source due offset")
                        ),
                        None => assert_eq!(expected["nan"], true),
                    }
                }
            }
            if source["timezone"] == "Pacific/Kiritimati"
                && row["input"]["name"] == "js-maximum-year"
            {
                let ParsedDueDate::Valid(maximum) = facts
                    .due_dates
                    .get("+275760-09-13T00:00:00.000Z")
                    .expect("actual maximum Date")
                else {
                    panic!("valid maximum Date");
                };
                assert_eq!(maximum.instant_ms, TIME_CLIP);
                assert!(maximum.local.utc_millis().expect("arithmetic UTC") > TIME_CLIP);
                let restored = source_utc_time(maximum.local)
                    .expect("UTC setter")
                    .expect("setter revived January 1");
                assert_eq!(
                    restored,
                    CivilDateTime {
                        date: CivilDate {
                            year: 275760,
                            month: 1,
                            day: 1
                        },
                        hour: 0,
                        minute: 0,
                        second: 0,
                        millisecond: 0
                    }
                    .utc_millis()
                    .expect("January")
                );
                revived = true;
            }
        }
    }
    assert!(revived);
}

#[test]
fn noncanonical_source_outcomes_are_not_replaced_with_a_uniform_source_error() {
    let source = &source_outputs()[0];
    let rows = source["rows"].as_array().expect("Source rows");
    let text = rows
        .iter()
        .find(|row| row["input"]["name"] == "unsupported-string-status")
        .expect("string filter");
    assert_eq!(text["source"]["filterCount"]["number"], 4);
    let scalar = rows
        .iter()
        .find(|row| row["input"]["name"] == "unsupported-scalar-status")
        .expect("scalar filter");
    assert_eq!(scalar["source"]["filterCount"]["nan"], true);
    assert_eq!(scalar["source"]["plan"]["active"], false);
    assert_eq!(
        scalar["source"]["plan"]["progress"],
        json!({"done":0,"total":1})
    );
    let object = rows
        .iter()
        .find(|row| row["input"]["name"] == "unsupported-length-object-status")
        .expect("length object");
    assert_eq!(object["source"]["error"]["name"], "TypeError");
}

#[test]
fn prototype_collisions_are_explicit_coverage_while_names_and_filter_choices_remain_supported() {
    let source = &source_outputs()[0];
    for key in source["objectPrototypeKeys"]
        .as_array()
        .expect("actual Object prototype names")
    {
        assert!(prototype_collision(key.as_str().expect("key")));
    }
    let rows = source["rows"].as_array().expect("rows");
    for (name, field) in [
        ("unsupported-task-key-constructor", "taskId"),
        (
            "unsupported-option-statusOptionId-constructor",
            "task.statusOptionId",
        ),
        (
            "unsupported-option-priorityOptionId-__proto__",
            "task.priorityOptionId",
        ),
        ("unsupported-own-reserved-task-key", "taskId"),
    ] {
        let row = rows
            .iter()
            .find(|row| row["input"]["name"] == name)
            .expect("collision case");
        let meta = metadata(&row["input"]["meta"]).expect("actual metadata");
        let facts = calendar(&source["rows"][0]["calendar"]);
        let result = plan_checklist(
            Some(&meta),
            &tasks(&row["input"]["tasks"]),
            &names(&row["input"]["names"]),
            &facts,
        );
        let ChecklistPlanResult::UnsupportedInput { field: actual, raw } = result else {
            panic!("reserved-key coverage gap");
        };
        assert_eq!(actual, field);
        assert!(Arc::ptr_eq(&raw, &meta.settings));
        let mut mixed = meta.clone();
        let ordinary = metadata(&source["rows"][2]["input"]["meta"]).expect("ordinary metadata");
        mixed.items.insert(0, ordinary.items[0].clone());
        assert!(
            matches!(
                plan_checklist(
                    Some(&mixed),
                    &tasks(&row["input"]["tasks"]),
                    &names(&row["input"]["names"]),
                    &facts
                ),
                ChecklistPlanResult::UnsupportedInput { .. }
            ),
            "an unsupported later row cannot become a filtered partial plan"
        );
    }
    let inherited = rows
        .iter()
        .find(|row| row["input"]["name"] == "unsupported-task-key-constructor")
        .expect("inherited task");
    assert_eq!(inherited["source"]["error"]["name"], "TypeError");
    let own = rows
        .iter()
        .find(|row| row["input"]["name"] == "unsupported-own-reserved-task-key")
        .expect("own task");
    assert!(
        own["source"].get("plan").is_some(),
        "valid own reserved property is still explicit initial unsupported coverage"
    );
    let option = rows
        .iter()
        .find(|row| row["input"]["name"] == "unsupported-option-statusOptionId-constructor")
        .expect("option collision");
    assert_eq!(option["source"]["items"][0]["status"]["function"], "Object");
}
