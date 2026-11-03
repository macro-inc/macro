use serde_json::json;

use super::*;

#[test]
fn env_names_are_dns_labels() {
    for ok in ["demo", "pr-1234", "a", "x1-y2"] {
        assert!(EnvName::parse(ok).is_ok(), "{ok}");
    }
    for bad in [
        "",
        "Demo",
        "-demo",
        "demo-",
        "de_mo",
        "a.b",
        &"x".repeat(31),
    ] {
        assert!(EnvName::parse(bad).is_err(), "{bad}");
    }
    let name = EnvName::parse("demo").unwrap();
    assert_eq!(name.namespace(), "macro-demo");
    assert_eq!(name.instance().unwrap().name(), "env-demo");
}

#[test]
fn targets_derive_hosts_and_origins() {
    let name = EnvName::parse("demo").unwrap();
    let kind = ClusterTarget::Kind { https_port: 9443 };
    assert_eq!(kind.host(&name), "demo.localhost");
    assert_eq!(kind.origin(&name), "https://demo.localhost:9443");
    assert_eq!(
        ClusterTarget::Kind { https_port: 443 }.origin(&name),
        "https://demo.localhost"
    );
    let eks = ClusterTarget::Eks {
        cluster: "c".into(),
        domain: "env.example.com".into(),
    };
    assert_eq!(eks.origin(&name), "https://demo.env.example.com");
    assert_eq!(eks.context(), "c");
}

#[test]
fn origin_rewrites_map_every_local_origin_to_the_public_one() {
    let instance = EnvName::parse("demo").unwrap().instance().unwrap();
    let origin = "https://demo.env.example.com";
    let rewrites = origin_rewrites(&instance, origin).unwrap();
    let auth = format!(
        "http://localhost:{}/oauth/redirect",
        instance.port(Port::Auth)
    );
    assert_eq!(
        render::rewrite(&auth, &rewrites),
        format!("{origin}/auth/oauth/redirect")
    );
    let proxy = format!("{}/cognition", proxy::url(&instance));
    assert_eq!(
        render::rewrite(&proxy, &rewrites),
        format!("{origin}/cognition")
    );
    // Longest first, so no rewrite runs inside another's output.
    let lens: Vec<usize> = rewrites.iter().map(|(from, _)| from.len()).collect();
    assert!(lens.windows(2).all(|w| w[0] >= w[1]));
}

#[test]
fn runtime_binaries_come_from_runtime_image_commands() {
    let compose = json!({ "services": {
        "a": { "image": RUNTIME_IMAGE_TAG, "command": ["/app/out/a_bin"] },
        "b": { "image": RUNTIME_IMAGE_TAG, "command": ["/app/out/b_bin", "--flag"] },
        "c": { "image": "redis", "command": ["/app/out/not_ours"] },
        "d": { "image": RUNTIME_IMAGE_TAG, "command": ["/app/out/a_bin"] },
    }});
    assert_eq!(runtime_binaries(&compose).unwrap(), vec!["a_bin", "b_bin"]);
}
