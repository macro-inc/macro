use super::*;
use reqwest::dns::Addrs;
use std::{net::IpAddr, str::FromStr};

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
