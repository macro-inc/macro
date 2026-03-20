use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::{HeaderValue, Request, StatusCode},
    response::IntoResponse,
};

use super::*;

// -- parse_header tests --

#[test]
fn parse_header_single_ipv4() {
    let header = HeaderValue::from_static("203.0.113.50");
    let ip = parse_header(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50)));
}

#[test]
fn parse_header_single_ipv6() {
    let header = HeaderValue::from_static("2001:db8::1");
    let ip = parse_header(&header).unwrap();
    assert_eq!(
        ip,
        IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1))
    );
}

#[test]
fn parse_header_multiple_ips_returns_first() {
    let header = HeaderValue::from_static("203.0.113.50, 70.41.3.18, 150.172.238.178");
    let ip = parse_header(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50)));
}

#[test]
fn parse_header_with_whitespace() {
    let header = HeaderValue::from_static("  203.0.113.50  , 70.41.3.18");
    let ip = parse_header(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50)));
}

#[test]
fn parse_header_ipv6_first_in_chain() {
    let header = HeaderValue::from_static("2001:db8::1, 203.0.113.50");
    let ip = parse_header(&header).unwrap();
    assert_eq!(
        ip,
        IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1))
    );
}

#[test]
fn parse_header_loopback_v4() {
    let header = HeaderValue::from_static("127.0.0.1");
    let ip = parse_header(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::LOCALHOST));
}

#[test]
fn parse_header_loopback_v6() {
    let header = HeaderValue::from_static("::1");
    let ip = parse_header(&header).unwrap();
    assert_eq!(ip, IpAddr::V6(Ipv6Addr::LOCALHOST));
}

#[test]
fn parse_header_unspecified_v4() {
    let header = HeaderValue::from_static("0.0.0.0");
    let ip = parse_header(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::UNSPECIFIED));
}

#[test]
fn parse_header_invalid_ip_returns_error() {
    let header = HeaderValue::from_static("not-an-ip");
    let err = parse_header(&header).unwrap_err();
    assert!(matches!(err, ClientIpError::ParseErr(_)));
}

#[test]
fn parse_header_empty_returns_error() {
    let header = HeaderValue::from_static("");
    let err = parse_header(&header).unwrap_err();
    assert!(matches!(err, ClientIpError::ParseErr(_)));
}

#[test]
fn parse_header_garbage_before_comma_returns_error() {
    let header = HeaderValue::from_static("garbage, 203.0.113.50");
    let err = parse_header(&header).unwrap_err();
    assert!(matches!(err, ClientIpError::ParseErr(_)));
}

#[test]
fn parse_header_only_whitespace_returns_error() {
    let header = HeaderValue::from_static("   ");
    let err = parse_header(&header).unwrap_err();
    assert!(matches!(err, ClientIpError::ParseErr(_)));
}

// -- ClientIp::origin_ip tests --

#[test]
fn origin_ip_forwarded_for_v4() {
    let ip = IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1));
    let client_ip = ClientIp::ForwardedFor(ip);
    assert_eq!(client_ip.origin_ip(), ip);
}

#[test]
fn origin_ip_forwarded_for_v6() {
    let ip = IpAddr::V6(Ipv6Addr::new(0xfe80, 0, 0, 0, 0, 0, 0, 1));
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

// -- FromRequestParts tests --

#[tokio::test]
async fn from_request_parts_uses_x_forwarded_for() {
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
async fn from_request_parts_picks_first_from_chain() {
    let (mut parts, _body) = Request::builder()
        .header("x-forwarded-for", "10.0.0.1, 172.16.0.1, 192.168.1.1")
        .body(())
        .unwrap()
        .into_parts();

    let client_ip = ClientIp::from_request_parts(&mut parts, &()).await.unwrap();

    assert_eq!(
        client_ip.origin_ip(),
        IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))
    );
}

#[tokio::test]
async fn from_request_parts_invalid_forwarded_for_returns_error() {
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

#[tokio::test]
async fn from_request_parts_no_header_no_connect_info_returns_error() {
    let (mut parts, _body) = Request::builder().body(()).unwrap().into_parts();

    let err = ClientIp::from_request_parts(&mut parts, &())
        .await
        .unwrap_err();
    assert!(matches!(err, ClientIpError::ExtensionErr(_)));
}

#[tokio::test]
async fn from_request_parts_falls_back_to_connect_info() {
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
async fn from_request_parts_prefers_header_over_connect_info() {
    let (mut parts, _body) = Request::builder()
        .header("x-forwarded-for", "10.0.0.1")
        .body(())
        .unwrap()
        .into_parts();
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 100)), 9000);
    parts.extensions.insert(ConnectInfo(addr));

    let client_ip = ClientIp::from_request_parts(&mut parts, &()).await.unwrap();

    assert!(matches!(client_ip, ClientIp::ForwardedFor(_)));
    assert_eq!(
        client_ip.origin_ip(),
        IpAddr::V4(Ipv4Addr::new(10, 0, 0, 1))
    );
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
    let err = ClientIpError::InvalidAscii(std::str::from_utf8(b"\xff").unwrap_err());
    let response = err.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
