use super::*;

#[test]
fn cloud_metadata_endpoints_are_refused() {
    let policy = AddressPolicy::public_only();

    // AWS/GCP/Azure IPv4, AWS IPv6, and Oracle.
    assert!(!policy.allows("169.254.169.254".parse().unwrap()));
    assert!(!policy.allows("fd00:ec2::254".parse().unwrap()));
    assert!(!policy.allows("192.0.0.192".parse().unwrap()));
}

#[test]
fn ipv6_wrappers_of_internal_ipv4_are_refused() {
    let policy = AddressPolicy::public_only();

    assert!(!policy.allows("::ffff:127.0.0.1".parse().unwrap()));
    assert!(!policy.allows("::ffff:169.254.169.254".parse().unwrap()));
    // NAT64 well-known prefix wrapping the metadata endpoint.
    assert!(!policy.allows("64:ff9b::a9fe:a9fe".parse().unwrap()));
    // 6to4 tunnels to an arbitrary embedded IPv4 address.
    assert!(!policy.allows("2002:7f00:1::".parse().unwrap()));
}

#[test]
fn ranges_the_old_filters_missed_are_refused() {
    let policy = AddressPolicy::public_only();

    assert!(!policy.allows("0.1.2.3".parse().unwrap()));
    assert!(!policy.allows("100.64.0.1".parse().unwrap()));
    assert!(!policy.allows("198.18.0.1".parse().unwrap()));
    assert!(!policy.allows("224.0.0.1".parse().unwrap()));
    assert!(!policy.allows("ff02::1".parse().unwrap()));
}

#[test]
fn public_addresses_are_allowed() {
    let policy = AddressPolicy::public_only();

    assert!(policy.allows("8.8.8.8".parse().unwrap()));
    assert!(policy.allows("::ffff:8.8.8.8".parse().unwrap()));
    assert!(policy.allows("64:ff9b::808:808".parse().unwrap()));
    assert!(policy.allows("2607:f8b0:4004:800::200e".parse().unwrap()));
}

#[test]
fn listed_private_networks_are_allowed_and_nothing_else() {
    let policy = AddressPolicy {
        private_networks_allowed: vec!["127.0.0.1/32".parse().unwrap()],
    };

    assert!(policy.allows("127.0.0.1".parse().unwrap()));
    assert!(!policy.allows("127.0.0.2".parse().unwrap()));
    assert!(!policy.allows("10.0.0.1".parse().unwrap()));
}
