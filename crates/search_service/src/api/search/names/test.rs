use models_search::names::{NameKind, NameQuery, NameSearchRequest};

use super::wants_team;

fn request(kinds: &[&[NameKind]]) -> NameSearchRequest {
    NameSearchRequest {
        names: kinds
            .iter()
            .map(|kinds| NameQuery {
                name: "x".to_string(),
                kinds: kinds.to_vec(),
            })
            .collect(),
    }
}

#[test]
fn reads_the_team_only_for_kinds_with_team_items() {
    assert!(wants_team(&request(&[&[]])));
    assert!(wants_team(&request(&[
        &[NameKind::Channel],
        &[NameKind::Tag]
    ])));
    assert!(wants_team(&request(&[&[NameKind::ChannelLabel]])));
    assert!(!wants_team(&request(&[&[
        NameKind::Channel,
        NameKind::Person
    ]])));
}
