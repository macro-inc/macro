use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use axum::{
    extract::{ConnectInfo, FromRequestParts},
    http::{HeaderValue, Request, StatusCode},
    response::IntoResponse,
};

use super::*;

// -- parse_viewer_address tests --

#[test]
fn viewer_address_ipv4_with_port() {
    let header = HeaderValue::from_static("203.0.113.50:12345");
    let ip = parse_viewer_address(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50)));
}

#[test]
fn viewer_address_ipv6_with_port() {
    let header = HeaderValue::from_static("[2001:db8::1]:12345");
    let ip = parse_viewer_address(&header).unwrap();
    assert_eq!(
        ip,
        IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1))
    );
}

#[test]
fn viewer_address_ipv4_without_port() {
    let header = HeaderValue::from_static("203.0.113.50");
    let ip = parse_viewer_address(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50)));
}

#[test]
fn viewer_address_with_whitespace() {
    let header = HeaderValue::from_static("  203.0.113.50:12345  ");
    let ip = parse_viewer_address(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50)));
}

#[test]
fn viewer_address_invalid_returns_error() {
    let header = HeaderValue::from_static("not-an-ip:1234");
    let err = parse_viewer_address(&header).unwrap_err();
    assert!(matches!(err, ClientIpError::ParseErr(_)));
}

#[test]
fn viewer_address_loopback() {
    let header = HeaderValue::from_static("127.0.0.1:9000");
    let ip = parse_viewer_address(&header).unwrap();
    assert_eq!(ip, IpAddr::V4(Ipv4Addr::LOCALHOST));
}

// -- ClientIp::origin_ip tests --

#[test]
fn origin_ip_cloudfront_viewer() {
    let ip = IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50));
    let client_ip = ClientIp::CloudFrontViewer(ip);
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
async fn prefers_cloudfront_viewer_address() {
    let (mut parts, _body) = Request::builder()
        .header("cloudfront-viewer-address", "203.0.113.50:12345")
        .body(())
        .unwrap()
        .into_parts();

    let client_ip = ClientIp::from_request_parts(&mut parts, &()).await.unwrap();

    assert!(matches!(client_ip, ClientIp::CloudFrontViewer(_)));
    assert_eq!(
        client_ip.origin_ip(),
        IpAddr::V4(Ipv4Addr::new(203, 0, 113, 50))
    );
}

#[tokio::test]
async fn cloudfront_viewer_ipv6() {
    let (mut parts, _body) = Request::builder()
        .header("cloudfront-viewer-address", "[2001:db8::1]:12345")
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
async fn falls_back_to_connect_info_when_no_viewer_header() {
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
async fn viewer_header_preferred_over_connect_info() {
    let (mut parts, _body) = Request::builder()
        .header("cloudfront-viewer-address", "203.0.113.50:12345")
        .body(())
        .unwrap()
        .into_parts();
    let addr = SocketAddr::new(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 100)), 9000);
    parts.extensions.insert(ConnectInfo(addr));

    let client_ip = ClientIp::from_request_parts(&mut parts, &()).await.unwrap();

    assert!(matches!(client_ip, ClientIp::CloudFrontViewer(_)));
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
async fn invalid_viewer_address_returns_error() {
    let (mut parts, _body) = Request::builder()
        .header("cloudfront-viewer-address", "not-an-ip:1234")
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
    let err = ClientIpError::InvalidAscii(std::str::from_utf8(b"\xff").unwrap_err());
    let response = err.into_response();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}
