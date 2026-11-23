use super::{envelope_pointer, messages};
use crate::repo::Repo;
use crate::sources::ItemRef;

const TYPES: &str = r#"
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Envelope {
    pub link_id: Uuid,
    pub sync_operation: External,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
pub enum External {
    GmailMessage(Payload),
    ListCandidates { job_id: Uuid },
    StartJob,
    #[serde(rename = "stop")]
    Finish,
}

#[derive(Serialize)]
#[serde(tag = "operation")]
pub enum Internal {
    Refresh { link_id: Uuid },
}

#[derive(Serialize)]
#[serde(tag = "event_type", content = "metadata")]
pub enum Adjacent {
    #[serde(rename = "email.link_connected")]
    LinkConnected(Metadata),
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum Untagged {
    One(Payload),
}

#[derive(Serialize)]
pub struct Plain {
    pub link_id: Uuid,
}
"#;

fn matchers(ident: &str, at: &str) -> Vec<String> {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("types.rs"), TYPES).unwrap();
    let item = ItemRef {
        file: "types.rs".to_owned(),
        ident: ident.to_owned(),
    };

    messages(&Repo::new(root.path()), &item, at)
        .unwrap()
        .into_iter()
        .map(|message| {
            format!(
                "{} {} :{}",
                message.ident, message.matcher, message.loc.line
            )
        })
        .collect()
}

#[test]
fn externally_tagged_variants_are_a_key_or_a_bare_string() {
    assert_eq!(
        matchers("External", "/syncOperation"),
        [
            "GmailMessage /syncOperation/gmail_message :12",
            "ListCandidates /syncOperation/list_candidates :13",
            "StartJob /syncOperation=start_job :14",
            "Finish /syncOperation=stop :16",
        ]
    );
}

#[test]
fn internally_tagged_variants_are_named_by_the_tag_field() {
    assert_eq!(matchers("Internal", ""), ["Refresh /operation=Refresh :22"]);
}

#[test]
fn adjacently_tagged_variants_are_named_by_the_tag_field() {
    assert_eq!(
        matchers("Adjacent", ""),
        ["LinkConnected /event_type=email.link_connected :29"]
    );
}

#[test]
fn a_struct_matches_any_message() {
    assert_eq!(matchers("Plain", ""), ["Plain * :39"]);
}

#[test]
fn untagged_enums_are_refused() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("types.rs"), TYPES).unwrap();
    let item = ItemRef {
        file: "types.rs".to_owned(),
        ident: "Untagged".to_owned(),
    };

    let error = messages(&Repo::new(root.path()), &item, "").unwrap_err();

    assert!(
        error
            .to_string()
            .contains("types.rs:34: `Untagged` is untagged"),
        "{error}"
    );
}

#[test]
fn the_envelope_field_gives_the_pointer_in_its_wire_name() {
    let root = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("types.rs"), TYPES).unwrap();
    let envelope = ItemRef {
        file: "types.rs".to_owned(),
        ident: "Envelope".to_owned(),
    };

    let pointer = envelope_pointer(&Repo::new(root.path()), &envelope, "External").unwrap();

    assert_eq!(pointer, "/syncOperation");
}
