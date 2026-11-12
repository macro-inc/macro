use super::{
    HostLookup, PublicAddressResolver, RefusedImageUrl, client_builder, is_blocked_ip, is_fetchable,
};
use crate::util::process_pre_insert::sfs_map::fetch_image;
use axum::Router;
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::get;
use reqwest::dns::{Name, Resolve};
use std::collections::VecDeque;
use std::io;
use std::net::{IpAddr, SocketAddr};
use std::str::FromStr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;
use url::Url;

const HOST: &str = "images.example.com";

#[test]
fn blocks_every_non_public_address() {
    for ip in [
        "0.1.2.3",
        "10.0.0.1",
        "100.64.0.1",
        "100.127.255.254",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "192.0.0.170",
        "192.168.1.1",
        "198.18.0.1",
        "224.0.0.1",
        "240.0.0.1",
        "255.255.255.255",
        "::",
        "::1",
        "fd00:ec2::254",
        "fe80::1",
        "ff02::1",
        "::ffff:127.0.0.1",
        "::ffff:169.254.169.254",
        "::127.0.0.1",
        "64:ff9b::a9fe:a9fe",
        "64:ff9b:1::1",
        "2002:7f00:1::",
        "2001::1",
    ] {
        assert!(is_blocked_ip(IpAddr::from_str(ip).unwrap()), "{ip}");
    }

    for ip in [
        "8.8.8.8",
        "100.128.0.1",
        "2606:4700::1111",
        "::ffff:8.8.8.8",
        "64:ff9b::808:808",
    ] {
        assert!(!is_blocked_ip(IpAddr::from_str(ip).unwrap()), "{ip}");
    }
}

#[test]
fn refuses_private_ip_literals_and_other_schemes() {
    for url in [
        "http://127.0.0.1/a.png",
        "http://2130706433/a.png",
        "http://169.254.169.254/latest/meta-data/",
        "http://[::ffff:127.0.0.1]/a.png",
        "http://[fd00:ec2::254]/a.png",
        "file:///etc/passwd",
        "ftp://images.example.com/a.png",
    ] {
        assert!(!is_fetchable(&Url::parse(url).unwrap()), "{url}");
    }

    for url in ["https://images.example.com/a.png", "http://8.8.8.8/a.png"] {
        assert!(is_fetchable(&Url::parse(url).unwrap()), "{url}");
    }
}

/// Answers each lookup with the next scripted answer.
struct ScriptedLookup {
    answers: Mutex<VecDeque<Vec<SocketAddr>>>,
}

impl HostLookup for ScriptedLookup {
    async fn lookup(&self, _host: &str) -> io::Result<Vec<SocketAddr>> {
        Ok(self.answers.lock().unwrap().pop_front().unwrap())
    }
}

#[tokio::test]
async fn checks_the_answer_of_every_lookup() {
    let resolver = PublicAddressResolver {
        lookup: Arc::new(ScriptedLookup {
            answers: Mutex::new(VecDeque::from([
                vec!["8.8.8.8:0".parse().unwrap()],
                vec!["127.0.0.1:0".parse().unwrap()],
                vec![
                    "8.8.8.8:0".parse().unwrap(),
                    "[::ffff:10.0.0.1]:0".parse().unwrap(),
                ],
            ])),
        }),
    };

    let first: Vec<SocketAddr> = resolver
        .resolve(Name::from_str(HOST).unwrap())
        .await
        .unwrap()
        .collect();
    assert_eq!(first, vec!["8.8.8.8:0".parse::<SocketAddr>().unwrap()]);

    // The same name rebinds to loopback on the next connection.
    assert!(
        resolver
            .resolve(Name::from_str(HOST).unwrap())
            .await
            .is_err()
    );

    // One internal address refuses the whole answer.
    assert!(
        resolver
            .resolve(Name::from_str(HOST).unwrap())
            .await
            .is_err()
    );
}

/// Resolves every name to loopback, where the test server listens.
struct LoopbackLookup;

impl HostLookup for LoopbackLookup {
    async fn lookup(&self, _host: &str) -> io::Result<Vec<SocketAddr>> {
        Ok(vec!["127.0.0.1:0".parse().unwrap()])
    }
}

/// An image host that redirects into the network, counting requests that
/// reach `/secret`.
struct RedirectingHost {
    address: SocketAddr,
    secret_hits: Arc<AtomicUsize>,
    server: tokio::task::JoinHandle<()>,
}

impl Drop for RedirectingHost {
    fn drop(&mut self) {
        self.server.abort();
    }
}

impl RedirectingHost {
    async fn start() -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let port = address.port();
        let secret_hits = Arc::new(AtomicUsize::new(0));
        let redirect = |location: String| {
            move || async move { (StatusCode::FOUND, [(header::LOCATION, location)]).into_response() }
        };
        let app = Router::new()
            .route("/image.png", get(|| async { "image" }))
            .route(
                "/to-ip-literal",
                get(redirect(format!("http://127.0.0.1:{port}/secret"))),
            )
            .route(
                "/to-mapped-ip-literal",
                get(redirect(format!("http://[::ffff:127.0.0.1]:{port}/secret"))),
            )
            .route(
                "/to-internal-name",
                get(redirect(format!("http://internal.test:{port}/secret"))),
            )
            .route(
                "/loop",
                get(redirect(format!("http://origin.test:{port}/loop"))),
            )
            .route(
                "/secret",
                get({
                    let secret_hits = secret_hits.clone();
                    move || async move {
                        secret_hits.fetch_add(1, Ordering::SeqCst);
                        "secret"
                    }
                }),
            );
        let server = tokio::spawn(async move {
            axum::serve(listener, app).await.unwrap();
        });
        Self {
            address,
            secret_hits,
            server,
        }
    }
}

#[tokio::test]
async fn refuses_redirects_into_the_network() {
    let host = RedirectingHost::start().await;
    let port = host.address.port();
    // `origin.test` stands in for a public image host: reqwest's static
    // override skips the resolver, so only the first hop reaches loopback.
    let client = client_builder(LoopbackLookup)
        .resolve("origin.test", host.address)
        .build()
        .unwrap();

    let image = client
        .get(format!("http://origin.test:{port}/image.png"))
        .send()
        .await
        .unwrap();
    assert_eq!(image.text().await.unwrap(), "image");

    for path in ["to-ip-literal", "to-mapped-ip-literal", "to-internal-name"] {
        let result = client
            .get(format!("http://origin.test:{port}/{path}"))
            .send()
            .await;
        assert!(result.is_err(), "{path}");
    }

    let direct = client
        .get(format!("http://internal.test:{port}/secret"))
        .send()
        .await;
    assert!(direct.is_err());

    assert_eq!(host.secret_hits.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn stops_after_five_redirects() {
    let host = RedirectingHost::start().await;
    let client = client_builder(LoopbackLookup)
        .resolve("origin.test", host.address)
        .build()
        .unwrap();

    let error = client
        .get(format!("http://origin.test:{}/loop", host.address.port()))
        .send()
        .await
        .unwrap_err();

    assert!(error.is_redirect(), "{error:#}");
}

#[tokio::test]
async fn fetch_image_refuses_ip_literal_hosts() {
    let host = RedirectingHost::start().await;
    let port = host.address.port();

    for url in [
        format!("http://127.0.0.1:{port}/secret"),
        format!("http://[::ffff:127.0.0.1]:{port}/secret"),
    ] {
        let error = fetch_image(&url).await.unwrap_err();
        assert!(
            error.downcast_ref::<RefusedImageUrl>().is_some(),
            "{error:#}"
        );
    }

    assert_eq!(host.secret_hits.load(Ordering::SeqCst), 0);
}
