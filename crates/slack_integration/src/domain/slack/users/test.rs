use super::*;

fn directory() -> UserDirectory {
    let mut users = Vec::new();
    for (json, filename) in [
        (
            include_str!("../../../../tests/fixtures/standard-export.json"),
            "users.json",
        ),
        (
            include_str!("../../../../tests/fixtures/corporate-export.json"),
            "users.json",
        ),
        (
            include_str!("../../../../tests/fixtures/enterprise-export.json"),
            "org_users.json",
        ),
    ] {
        let root: serde_json::Value = serde_json::from_str(json).unwrap();
        assert!(filename.parse::<UsersFile>().is_ok());
        users.extend(serde_json::from_value::<Vec<ExportUser>>(root[filename].clone()).unwrap());
    }
    UserDirectory::new(users).unwrap()
}

fn author(directory: &UserDirectory, json: &str) -> ResolvedAuthor {
    directory.author(&serde_json::from_str(json).unwrap())
}

fn system(name: &str) -> ResolvedAuthor {
    ResolvedAuthor::SystemBot {
        imported_author: name.to_owned(),
    }
}

#[test]
fn lowercases_raw_emails_without_canonicalizing_dots_or_plus_aliases() {
    let directory = directory();
    let id = directory.participant(&"U100".parse().unwrap()).unwrap();
    assert_eq!(id.as_ref(), "macro|alice.example+archive@gmail.com");
    assert_eq!(
        author(&directory, r#"{"user":"U100"}"#),
        ResolvedAuthor::User(id)
    );
    assert_eq!(
        directory
            .participant(&"W100".parse().unwrap())
            .unwrap()
            .as_ref(),
        "macro|enterprise+alias@example.test"
    );
}

#[test]
fn duplicate_emails_map_to_one_identity_but_not_a_self_dm() {
    let directory = directory();
    let first = "U100".parse().unwrap();
    let duplicate = "U300".parse().unwrap();
    assert_eq!(
        directory.participant(&first),
        directory.participant(&duplicate)
    );
    assert!(
        directory
            .direct_message_members(&[first, duplicate])
            .is_none()
    );
}

#[test]
fn dm_members_must_be_exactly_two_distinct_email_bearing_users() {
    let directory = directory();
    for ids in [
        vec![],
        vec!["U100"],
        vec!["U100", "U100"],
        vec!["U100", "U400"],
        vec!["U100", "U404"],
        vec!["U100", "U500"],
        vec!["U100", "USLACKBOT"],
        vec!["U100", "U200", "W100"],
    ] {
        let ids: Vec<_> = ids.into_iter().map(|id| id.parse().unwrap()).collect();
        assert!(directory.direct_message_members(&ids).is_none());
    }
    let pair = directory
        .direct_message_members(&["U100".parse().unwrap(), "U200".parse().unwrap()])
        .unwrap();
    assert_eq!(pair[0].as_ref(), "macro|alice.example+archive@gmail.com");
    assert_eq!(pair[1].as_ref(), "macro|bob@example.test");
}

#[test]
fn phantom_connect_and_missing_users_get_source_names_or_ids() {
    let directory = directory();
    for (json, name) in [
        (r#"{"user":"W200"}"#, "phantom"),
        (r#"{"user":"U999"}"#, "Connect Guest"),
        (r#"{"user":"U404"}"#, "U404"),
        (
            r#"{"user":"U404","user_profile":{"display_name":"Message Guest"}}"#,
            "Message Guest",
        ),
        (r#"{}"#, "Unknown Slack author"),
    ] {
        assert_eq!(author(&directory, json), system(name));
    }
    assert_eq!(directory.display_name(&"U404".parse().unwrap()), "U404");
    assert_eq!(
        directory.display_name(&"U400".parse().unwrap()),
        "External Example"
    );
}

#[test]
fn embedded_profile_supplies_email_without_modifying_membership_directory() {
    let directory = directory();
    for id in ["U999", "U404"] {
        let json = format!(
            r#"{{"user":"{id}","user_profile":{{"email":"Connect.User+Alias@Example.Test"}}}}"#
        );
        assert_eq!(
            author(&directory, &json),
            ResolvedAuthor::User(
                MacroUserIdStr::try_from_email("connect.user+alias@example.test").unwrap()
            )
        );
        assert!(directory.participant(&id.parse().unwrap()).is_none());
    }
    let resolved = author(
        &directory,
        r#"{"user":"U200","user_profile":{"email":"other@example.test"}}"#,
    );
    assert_eq!(
        resolved,
        ResolvedAuthor::User(directory.participant(&"U200".parse().unwrap()).unwrap())
    );
}

#[test]
fn explicit_bot_and_slackbot_never_impersonate_email_bearing_users() {
    let directory = directory();
    for (json, name) in [
        (
            r#"{"subtype":"bot_message","user":"U100","username":"Build Bot","user_profile":{"email":"human@example.test"}}"#,
            "Build Bot",
        ),
        (
            r#"{"subtype":"bot_message","bot_profile":{"name":"Profile Bot"}}"#,
            "Profile Bot",
        ),
        (
            r#"{"user":"USLACKBOT","user_profile":{"email":"human@example.test"}}"#,
            "slackbot",
        ),
        (r#"{"user":"U500"}"#, "integration"),
    ] {
        assert_eq!(author(&directory, json), system(name));
    }
    assert_eq!(
        author(
            &UserDirectory::default(),
            r#"{"user":"USLACKBOT","user_profile":{"email":"human@example.test"}}"#
        ),
        system("USLACKBOT")
    );
}

#[test]
fn invalid_emails_and_blank_display_names_fall_back_safely() {
    for email in [
        "",
        "not-an-email",
        " alice@example.test",
        "alice@example.test\n",
    ] {
        let message: MessageContent = serde_json::from_value(serde_json::json!({
            "user_profile": {"email": email, "display_name": "  ", "real_name": "Fallback Name"}
        }))
        .unwrap();
        assert_eq!(directory().author(&message), system("Fallback Name"));
    }
}

#[test]
fn repeated_ids_are_idempotent_but_conflicting_ids_fail_closed() {
    let user: ExportUser =
        serde_json::from_str(r#"{"id":"U100","profile":{"email":"a@example.test"}}"#).unwrap();
    assert!(UserDirectory::new([user.clone(), user.clone()]).is_ok());
    let mut changed = user.clone();
    changed.profile.as_mut().unwrap().email = Some("b@example.test".to_owned());
    assert!(UserDirectory::new([user, changed]).is_err());
    assert!("team.json".parse::<UsersFile>().is_err());
}
