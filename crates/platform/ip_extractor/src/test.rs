use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::{HeaderValue, Request, StatusCode},
    response::IntoResponse,
};

use super::*;

// -- parse_header tests --

#[test]
fn parse_single_ipv4() {
    let header = HeaderValue::from_static("203.0.113.50");
    let ip = parse_header(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50)));
}

#[test]
fn parse_single_ipv6() {
    let header = HeaderValue::from_static("2001:db8::1");
    let ip = parse_header(&header).unwrap();
    assert_eq!(
        ip,
        IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1))
    );
}

#[test]
fn parse_takes_last_ip_in_chain() {
    let header = HeaderValue::from_static("203.0.113.50, 10.0.0.1, 192.168.1.1");
    let ip = parse_header(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)));
}

#[test]
fn parse_two_ips_takes_last() {
    let header = HeaderValue::from_static("203.0.113.50, 10.0.0.1");
    let ip = parse_header(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1)));
}

#[test]
fn parse_with_whitespace() {
    let header = HeaderValue::from_static("  203.0.113.50  ");
    let ip = parse_header(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50)));
}

#[test]
fn parse_invalid_returns_error() {
    let header = HeaderValue::from_static("not-an-ip");
    let err = parse_header(&header).unwrap_err();
    assert!(matches!(err, ClientIpError::ParseErr(_)));
}

#[test]
fn parse_loopback() {
    let header = HeaderValue::from_static("127.0.0.1");
    let ip = parse_header(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::LOCALHOST));
}

// -- ClientIp::origin_ip tests --

#[test]
fn origin_ip_forwarded_for() {
    let ip = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50));
    let client_ip = ClientIp::ForwardedFor(ip);
    assert_eq!(client_ip.origin_ip(), ip);
}

#[test]
fn origin_ip_direct_ip() {
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)), 12345);
    let client_ip = ClientIp::DirectIp(ConnectInfo(addr));
    assert_eq!(
        client_ip.origin_ip(),
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))
    );
}

#[test]
fn origin_ip_direct_ip_v6() {
    let addr = SocketAddr::new(IpAddr::V6(Ipv6Addr::LOCALHOST), 443);
    let client_ip = ClientIp::DirectIp(ConnectInfo(addr));
    assert_eq!(client_ip.origin_ip(), IpAddr::V6(Ipv6Addr::LOCALHOST));
}

// -- Display tests --

#[test]
fn display_forwarded_for() {
    let ip = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50));
    let client_ip = ClientIp::ForwardedFor(ip);
    assert_eq!(client_ip.to_string(), "203.0.113.50");
}

#[test]
fn display_direct_ip() {
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1)), 8080);
    let client_ip = ClientIp::DirectIp(ConnectInfo(addr));
    assert_eq!(client_ip.to_string(), "192.168.1.1:8080");
}

// -- FromRequestParts tests --

#[tokio::test]
async fn prefers_x_forwarded_for() {
    let (mut parts, _body) = Request::builder()
        .header("x-forwarded-for", "203.0.113.50")
        .body(())
        .unwrap()
        .into_parts();

    let client_ip = ClientIp::from_request_parts(&mut parts, &()).await.unwrap();

    assert!(matches!(client_ip, ClientIp::ForwardedFor(_)));
    assert_eq!(
        client_ip.origin_ip(),
        IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50))
    );
}

#[tokio::test]
async fn x_forwarded_for_ipv6() {
    let (mut parts, _body) = Request::builder()
        .header("x-forwarded-for", "2001:db8::1")
        .body(())
        .unwrap()
        .into_parts();

    let client_ip = ClientIp::from_request_parts(&mut parts, &()).await.unwrap();

    assert_eq!(
        client_ip.origin_ip(),
        IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1))
    );
}

#[tokio::test]
async fn x_forwarded_for_takes_last_ip() {
    let (mut parts, _body) = Request::builder()
        .header("x-forwarded-for", "203.0.113.50, 10.0.0.1, 192.168.1.1")
        .body(())
        .unwrap()
        .into_parts();

    let client_ip = ClientIp::from_request_parts(&mut parts, &()).await.unwrap();

    assert_eq!(
        client_ip.origin_ip(),
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 1))
    );
}

#[tokio::test]
async fn falls_back_to_connect_info_when_no_forwarded_header() {
    let (mut parts, _body) = Request::builder().body(()).unwrap().into_parts();
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 100)), 9000);
    parts.extensions.insert(ConnectInfo(addr));

    let client_ip = ClientIp::from_request_parts(&mut parts, &()).await.unwrap();

    assert!(matches!(client_ip, ClientIp::DirectIp(_)));
    assert_eq!(
        client_ip.origin_ip(),
        IpAddr::V4(Ipv4Addr::new(192, 168, 1, 100))
    );
}

#[tokio::test]
async fn forwarded_header_preferred_over_connect_info() {
    let (mut parts, _body) = Request::builder()
        .header("x-forwarded-for", "203.0.113.50")
        .body(())
        .unwrap()
        .into_parts();
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 100)), 9000);
    parts.extensions.insert(ConnectInfo(addr));

    let client_ip = ClientIp::from_request_parts(&mut parts, &()).await.unwrap();

    assert!(matches!(client_ip, ClientIp::ForwardedFor(_)));
    assert_eq!(
        client_ip.origin_ip(),
        IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50))
    );
}

#[tokio::test]
async fn no_header_no_connect_info_returns_error() {
    let (mut parts, _body) = Request::builder().body(()).unwrap().into_parts();

    let err = ClientIp::from_request_parts(&mut parts, &())
        .await
        .unwrap_err();
    assert!(matches!(err, ClientIpError::ExtensionErr(_)));
}

#[tokio::test]
async fn invalid_forwarded_address_returns_error() {
    let (mut parts, _body) = Request::builder()
        .header("x-forwarded-for", "not-an-ip")
        .body(())
        .unwrap()
        .into_parts();

    let err = ClientIp::from_request_parts(&mut parts, &())
        .await
        .unwrap_err();
    assert!(matches!(err, ClientIpError::ParseErr(_)));
}

// -- ClientIpError::into_response tests --

#[test]
fn error_response_parse_err_is_400() {
    let err: ClientIpError = "not-an-ip".parse::<IpAddr>().unwrap_err().into();
    let response = err.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[test]
fn error_response_invalid_ascii_is_400() {
    #[expect(invalid_from_utf8)]
    let err = ClientIpError::InvalidAscii(std::str::from_utf8(b"\xff").unwrap_err());
    let response = err.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
