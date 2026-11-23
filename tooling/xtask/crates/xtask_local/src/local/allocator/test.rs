use super::*;

#[test]
fn networks_map_back_to_their_instance() {
    assert_eq!(instance_of_network("databases-crmgp"), Some("crmgp"));
    assert_eq!(instance_of_network("auth-crmgp"), Some("crmgp"));
    assert_eq!(instance_of_network("macro-crmgp_services"), Some("crmgp"));
    assert_eq!(
        instance_of_network("macro-crmgp_auth-internal"),
        Some("crmgp")
    );
    assert_eq!(instance_of_network("databases"), None);
    assert_eq!(instance_of_network("macro_services"), None);
    assert_eq!(instance_of_network("macro_auth-internal"), None);
    assert_eq!(instance_of_network("bridge"), None);
}

#[test]
fn projects_map_back_to_their_instance() {
    assert_eq!(instance_of_project("macro-crmgp"), Some("crmgp"));
    assert_eq!(instance_of_project("macro"), Some(DEFAULT_NAME));
    assert_eq!(instance_of_project("macro-"), None);
    assert_eq!(instance_of_project("someone-else"), None);
}

/// The default instance's containers own its fixed ports but aren't a named
/// instance with a window.
#[test]
fn only_named_instances_are_grouped_for_their_windows() {
    let container = |project: Option<&str>| docker::MachineContainer {
        id: String::new(),
        project: project.map(str::to_string),
        service: None,
        running: true,
        published: Vec::new(),
    };
    let containers = [
        container(Some("macro-up")),
        container(Some("macro-up")),
        container(Some("macro")),
        container(Some("other")),
        container(None),
    ];

    let grouped = named_containers(&containers);

    assert_eq!(grouped.keys().copied().collect::<Vec<_>>(), ["up"]);
    assert_eq!(grouped["up"].len(), 2);
}

#[test]
fn an_instance_claims_its_own_networks_by_name() {
    let instance = Instance::derive(Some("agent-a"), None).unwrap();

    assert_eq!(
        own_networks(&instance),
        BTreeSet::from([
            "databases-agent-a".to_string(),
            "auth-agent-a".to_string(),
            "macro-agent-a_services".to_string(),
            "macro-agent-a_auth-internal".to_string(),
        ])
    );
}
