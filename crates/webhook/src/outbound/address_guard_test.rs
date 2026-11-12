use super::*;
use std::str::FromStr;

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
    ] {
        assert!(
            !is_blocked_ip(ip.parse().unwrap()),
            "{ip} should be allowed"
        );
    }
}

struct FixedResolver(Vec<IpAddr>);

impl Resolve for FixedResolver {
    fn resolve(&self, _name: Name) -> Resolving {
        let addresses: Vec<SocketAddr> = self.0.iter().map(|ip| SocketAddr::new(*ip, 0)).collect();
        Box::pin(async move {
            let addresses: Addrs = Box::new(addresses.into_iter());
            Ok(addresses)
        })
    }
}

#[tokio::test]
async fn filtering_resolver_drops_blocked_answers() {
    let resolver = BlockedAddressFilteringResolver {
        inner: Arc::new(FixedResolver(vec![
            "127.0.0.1".parse().unwrap(),
            "93.184.215.14".parse().unwrap(),
            "::ffff:10.0.0.1".parse().unwrap(),
        ])),
    };

    let Ok(addresses) = resolver
        .resolve(Name::from_str("example.test").unwrap())
        .await
    else {
        panic!("a public answer should remain");
    };

    let allowed: Vec<IpAddr> = addresses.map(|address| address.ip()).collect();
    assert_eq!(allowed, vec!["93.184.215.14".parse::<IpAddr>().unwrap()]);
}

#[tokio::test]
async fn filtering_resolver_fails_when_every_answer_is_blocked() {
    let resolver = BlockedAddressFilteringResolver {
        inner: Arc::new(FixedResolver(vec![
            "127.0.0.1".parse().unwrap(),
            "::ffff:127.0.0.1".parse().unwrap(),
        ])),
    };

    let Err(error) = resolver
        .resolve(Name::from_str("example.test").unwrap())
        .await
    else {
        panic!("every answer is blocked");
    };

    let error = error
        .downcast_ref::<io::Error>()
        .expect("blocked answers fail with an io error");
    assert_eq!(error.kind(), io::ErrorKind::PermissionDenied);
}
