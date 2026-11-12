use super::*;

fn ip(text: &str) -> IpAddr {
    text.parse().unwrap()
}

#[test]
fn only_public_unicast_is_public() {
    for refused in [
        "0.1.2.3",
        "10.0.0.1",
        "100.64.0.1",
        "100.127.255.254",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "192.0.0.1",
        "192.168.1.1",
        "198.18.0.1",
        "224.0.0.1",
        "240.0.0.1",
        "255.255.255.255",
        "::",
        "::1",
        "fc00::1",
        "fd00:ec2::254",
        "fe80::1",
        "ff02::1",
        "2001:db8::1",
        "3fff::1",
        "3fff:fff::1",
        "2001::1",
        "2002:a9fe:a9fe::1",
        // IPv6 wrapping an internal IPv4 address is judged as that address.
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
        "64:ff9b::a9fe:a9fe",
        "64:ff9b::10.0.0.1",
        "::10.0.0.1",
    ] {
        assert!(!is_public(ip(refused)), "{refused} should be refused");
    }
    for allowed in [
        "1.1.1.1",
        "8.8.8.8",
        "100.63.255.255",
        "100.128.0.1",
        "2606:4700:4700::1111",
        "3fff:1000::1",
        "::ffff:8.8.8.8",
        "64:ff9b::808:808",
    ] {
        assert!(is_public(ip(allowed)), "{allowed} should be allowed");
    }
}
