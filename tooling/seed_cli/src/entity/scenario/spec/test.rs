use super::*;

fn example_json() -> String {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("seed/scenarios/team-perms.json");
    std::fs::read_to_string(path).expect("example scenario file exists")
}

fn example() -> ScenarioSpec {
    ScenarioSpec::parse(&example_json()).expect("example scenario is valid")
}

fn minimal(json: serde_json::Value) -> Result<ScenarioSpec, anyhow::Error> {
    ScenarioSpec::parse(&json.to_string())
}

#[test]
fn derive_id_is_deterministic_and_marked() {
    let a = derive_id("team-perms", "document", "q3-plan");
    let b = derive_id("team-perms", "document", "q3-plan");
    assert_eq!(a, b);

    let other_key = derive_id("team-perms", "document", "handbook");
    let other_kind = derive_id("team-perms", "chat", "q3-plan");
    let other_scenario = derive_id("other", "document", "q3-plan");
    assert_ne!(a, other_key);
    assert_ne!(a, other_kind);
    assert_ne!(a, other_scenario);

    let text = a.to_string();
    assert!(
        text.starts_with(SEED_MARKER),
        "id {text} carries the marker"
    );
    assert!(
        text.starts_with(&scenario_marker("team-perms")),
        "id {text} carries the scenario marker {}",
        scenario_marker("team-perms")
    );
    assert_eq!(a.get_version_num(), 8);
}

#[test]
fn scenario_marker_shape() {
    let marker = scenario_marker("team-perms");
    assert_eq!(marker.len(), 8);
    assert!(marker.starts_with(SEED_MARKER));
    assert_ne!(marker, scenario_marker("other-scenario"));
}

#[test]
fn example_scenario_parses() {
    let spec = example();
    assert_eq!(spec.scenario, "team-perms");
    assert_eq!(spec.users.len(), 6);
    assert_eq!(spec.user_id("alice"), "macro|alice@seed.macro.local");

    let handbook = &spec.documents["handbook"];
    assert_eq!(handbook.link_share, Some(LinkShare::Public));
    assert_eq!(handbook.link_share_access_level, Some(ShareLevel::View));

    let bob_notes = &spec.documents["bob-notes"];
    assert_eq!(bob_notes.link_share, Some(LinkShare::Team));
    assert_eq!(bob_notes.link_share_access_level, Some(ShareLevel::View));
}

#[test]
fn team_and_channel_derivations() {
    let spec = example();

    assert_eq!(spec.team_of("alice"), Some("acme"));
    assert_eq!(spec.team_of("bob"), Some("acme"));
    assert_eq!(spec.team_of("dave"), None);

    let mut hq_members = spec.channel_members("acme-hq");
    hq_members.sort();
    assert_eq!(hq_members, vec!["alice", "bob", "carol", "erin"]);
    assert_eq!(spec.channel_owner("acme-hq"), "alice");

    assert_eq!(spec.channel_owner("dm-alice-dave"), "alice");
    let mut eng_members = spec.channel_members("eng");
    eng_members.sort();
    assert_eq!(eng_members, vec!["alice", "bob", "dave"]);
}

#[test]
fn call_participants_include_creator_once() {
    let spec = example();
    assert_eq!(spec.call_participants("eng-standup"), vec!["alice", "bob"]);
    assert_eq!(spec.call_participants("dm-huddle"), vec!["dave", "alice"]);
}

#[test]
fn rejects_unknown_references() {
    let result = minimal(serde_json::json!({
        "scenario": "bad",
        "users": { "alice": { "email": "alice@x.local" } },
        "documents": {
            "doc": {
                "owner": "ghost",
                "share": [ { "with": "team:none", "level": "view" } ]
            }
        }
    }));
    let error = result.unwrap_err().to_string();
    assert!(error.contains("unknown user `ghost`"), "{error}");
    assert!(error.contains("unknown team `none`"), "{error}");
}

#[test]
fn rejects_second_team_membership() {
    let result = minimal(serde_json::json!({
        "scenario": "bad",
        "users": {
            "alice": { "email": "alice@x.local" },
            "bob": { "email": "bob@x.local" },
            "carol": { "email": "carol@x.local" }
        },
        "teams": {
            "one": { "owner": "alice", "members": { "bob": "member" } },
            "two": { "owner": "carol", "members": { "bob": "admin" } }
        }
    }));
    let error = result.unwrap_err().to_string();
    assert!(error.contains("one team"), "{error}");
}

#[test]
fn rejects_bad_channels() {
    let result = minimal(serde_json::json!({
        "scenario": "bad",
        "users": {
            "alice": { "email": "alice@x.local" },
            "bob": { "email": "bob@x.local" }
        },
        "teams": { "acme": { "owner": "alice" } },
        "channels": {
            "dm": { "type": "direct_message", "members": ["alice"] },
            "hq": { "type": "team", "team": "acme", "members": ["bob"] },
            "orphan": { "type": "private" }
        }
    }));
    let error = result.unwrap_err().to_string();
    assert!(error.contains("exactly two distinct members"), "{error}");
    assert!(
        error.contains("derives owner/members from the team"),
        "{error}"
    );
    assert!(error.contains("must set `owner`"), "{error}");
}

#[test]
fn rejects_call_and_message_membership_violations() {
    let result = minimal(serde_json::json!({
        "scenario": "bad",
        "users": {
            "alice": { "email": "alice@x.local" },
            "eve": { "email": "eve@x.local" }
        },
        "channels": {
            "eng": { "type": "private", "owner": "alice" }
        },
        "calls": {
            "call": { "channel": "eng", "created_by": "eve" }
        },
        "messages": [
            { "channel": "eng", "from": "eve", "text": "hi" }
        ]
    }));
    let error = result.unwrap_err().to_string();
    assert!(
        error.contains("created_by `eve` is not a member"),
        "{error}"
    );
    assert!(error.contains("sender `eve` is not a member"), "{error}");
}

#[test]
fn rejects_project_cycles() {
    let result = minimal(serde_json::json!({
        "scenario": "bad",
        "users": { "alice": { "email": "alice@x.local" } },
        "projects": {
            "a": { "owner": "alice", "parent": "b" },
            "b": { "owner": "alice", "parent": "a" }
        }
    }));
    let error = result.unwrap_err().to_string();
    assert!(error.contains("parent cycle"), "{error}");
}

#[test]
fn rejects_unknown_roles() {
    let result = minimal(serde_json::json!({
        "scenario": "bad",
        "users": {
            "alice": { "email": "alice@x.local", "roles": ["professional_subscriber", "royalty"] }
        }
    }));
    let error = result.unwrap_err().to_string();
    assert!(error.contains("unknown role `royalty`"), "{error}");
    assert!(!error.contains("professional_subscriber"), "{error}");
}

#[test]
fn rejects_unknown_fields() {
    let result = minimal(serde_json::json!({
        "scenario": "bad",
        "users": { "alice": { "email": "alice@x.local", "surprise": true } }
    }));
    assert!(result.unwrap_err().to_string().contains("unknown field"));
}

#[test]
fn rejects_incomplete_link_share_policies() {
    let missing_access_level = minimal(serde_json::json!({
        "scenario": "bad",
        "users": { "alice": { "email": "alice@x.local" } },
        "documents": {
            "doc": { "owner": "alice", "link_share": "TEAM" }
        }
    }));
    let error = missing_access_level.unwrap_err().to_string();
    assert!(
        error.contains("sets link_share but not link_share_access_level"),
        "{error}"
    );

    let missing_scope = minimal(serde_json::json!({
        "scenario": "bad",
        "users": { "alice": { "email": "alice@x.local" } },
        "chats": {
            "chat": { "owner": "alice", "link_share_access_level": "view" }
        }
    }));
    let error = missing_scope.unwrap_err().to_string();
    assert!(
        error.contains("sets link_share_access_level but not link_share"),
        "{error}"
    );
}

#[test]
fn rejects_legacy_public_link_field() {
    let result = minimal(serde_json::json!({
        "scenario": "bad",
        "users": { "alice": { "email": "alice@x.local" } },
        "projects": {
            "project": { "owner": "alice", "public": "view" }
        }
    }));
    assert!(result.unwrap_err().to_string().contains("unknown field"));
}

#[test]
fn entity_ref_parsing() {
    assert_eq!(
        EntityRef::parse("user:alice").unwrap(),
        EntityRef::User("alice".to_string())
    );
    assert_eq!(
        EntityRef::parse("document:q3-plan").unwrap(),
        EntityRef::Document("q3-plan".to_string())
    );
    assert!(EntityRef::parse("nope").is_err());
    assert!(EntityRef::parse("user:").is_err());
    assert!(EntityRef::parse("widget:x").is_err());
}

#[test]
fn email_thread_keeps_supplied_html() {
    let spec = minimal(serde_json::json!({
        "scenario": "html-mail",
        "users": { "alice": { "email": "alice@x.local" } },
        "emails": {
            "alice-inbox": {
                "owner": "alice",
                "threads": {
                    "wide": {
                        "subject": "Wide HTML",
                        "from": "notifications@github.com",
                        "body": "plain",
                        "body_html": "<pre style='color:#555'>diff</pre>"
                    }
                }
            }
        }
    }))
    .unwrap();
    let thread = &spec.emails["alice-inbox"].threads["wide"];
    assert_eq!(
        thread.body_html.as_deref(),
        Some("<pre style='color:#555'>diff</pre>")
    );
    assert_eq!(thread.body.as_deref(), Some("plain"));
}

#[test]
fn project_chain_walks_parents() {
    let spec = minimal(serde_json::json!({
        "scenario": "chain",
        "users": { "alice": { "email": "alice@x.local" } },
        "projects": {
            "root": { "owner": "alice" },
            "mid": { "owner": "alice", "parent": "root" },
            "leaf": { "owner": "alice", "parent": "mid" }
        }
    }))
    .unwrap();
    assert_eq!(spec.project_chain("leaf"), vec!["leaf", "mid", "root"]);
    assert_eq!(spec.project_chain("root"), vec!["root"]);
}
