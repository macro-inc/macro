use super::*;

#[test]
fn blocks_internal_ipv4_ranges() {
    for ip in [
        "0.0.0.0",
        "0.1.2.3",
        "10.1.2.3",
        "100.64.0.1",
        "100.127.255.254",
        "100.100.100.200",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "192.0.0.192",
        "192.168.1.1",
        "198.18.0.1",
        "224.0.0.1",
        "240.0.0.1",
        "255.255.255.255",
    ] {
        assert!(is_blocked_ip(ip.parse().unwrap()), "{ip} should be blocked");
    }
}

#[test]
fn blocks_internal_ipv6_ranges() {
    for ip in [
        "::",
        "::1",
        "fe80::1",
        "fec0::1",
        "fc00::1",
        "fd00:ec2::254",
        "ff02::1",
        "100::1",
        "2001::1",
        "2001:db8::1",
        "3fff::1",
        "64:ff9b:1::1",
        "2001:2::1",
        "5f00::1",
        "4000::1",
        "1000::1",
        "::127.0.0.1",
        "::8.8.8.8",
    ] {
        assert!(is_blocked_ip(ip.parse().unwrap()), "{ip} should be blocked");
    }
}

#[test]
fn judges_ipv6_wrapped_ipv4_by_the_wrapped_address() {
    for ip in [
        "::ffff:127.0.0.1",
        "::ffff:10.0.0.1",
        "::ffff:169.254.169.254",
        "64:ff9b::7f00:1",
        "64:ff9b::a9fe:a9fe",
        "2002:7f00:1::1",
        "2002:a00:1::1",
    ] {
        assert!(is_blocked_ip(ip.parse().unwrap()), "{ip} should be blocked");
    }

    for ip in ["::ffff:8.8.8.8", "64:ff9b::808:808", "2002:808:808::1"] {
        assert!(
            !is_blocked_ip(ip.parse().unwrap()),
            "{ip} should be allowed"
        );
    }
}

#[test]
fn allows_public_addresses() {
    for ip in [
        "1.1.1.1",
        "8.8.8.8",
        "100.63.255.255",
        "100.128.0.1",
        "2606:4700:4700::1111",
        "3fff:1000::1",
        "2001:2:1::1",
    ] {
        assert!(
            !is_blocked_ip(ip.parse().unwrap()),
            "{ip} should be allowed"
        );
    }
}

#[test]
fn blocks_localhost_and_blocked_literal_hosts() {
    for host in [
        "localhost",
        "api.localhost",
        "[::ffff:127.0.0.1]",
        "100.64.0.1",
    ] {
        assert!(is_blocked_host(host), "{host} should be blocked");
    }

    assert!(!is_blocked_host("example.com"));
    assert!(!is_blocked_host("8.8.8.8"));
}
