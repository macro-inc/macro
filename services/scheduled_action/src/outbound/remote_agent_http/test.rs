use super::{
    MAX_OUTPUT_CHARS, RemoteAgentEndpointPolicy, is_blocked_host, is_blocked_ip, parse_response,
    validate_endpoint_url,
};
use std::net::IpAddr;
use std::str::FromStr;

fn blocked(ip: &str) -> bool {
    is_blocked_ip(IpAddr::from_str(ip).expect("valid ip"))
}

#[test]
fn rejects_private_loopback_and_metadata_addresses() {
    assert!(blocked("127.0.0.1"));
    assert!(blocked("10.1.2.3"));
    assert!(blocked("192.168.0.4"));
    assert!(blocked("172.16.9.9"));
    assert!(blocked("169.254.169.254"));
    assert!(blocked("0.0.0.0"));
    assert!(blocked("255.255.255.255"));
    assert!(blocked("::1"));
    assert!(blocked("fd00::1"));
    assert!(blocked("fe80::1"));
    // IPv4-mapped forms reach the same hosts as the addresses they embed.
    assert!(blocked("::ffff:169.254.169.254"));
    assert!(blocked("::ffff:127.0.0.1"));
    assert!(blocked("::ffff:10.0.0.1"));
}

#[test]
fn allows_public_addresses() {
    assert!(!blocked("93.184.216.34"));
    assert!(!blocked("2606:2800:220:1:248:1893:25c8:1946"));
}

#[test]
fn rejects_localhost_hostnames_without_resolving() {
    assert!(is_blocked_host("localhost"));
    assert!(is_blocked_host("LOCALHOST"));
    assert!(is_blocked_host("agent.localhost"));
    assert!(is_blocked_host("127.0.0.1"));
    assert!(is_blocked_host("[::1]"));
    assert!(!is_blocked_host("agent.example.com"));
}

#[test]
fn requires_https_under_the_default_policy() {
    let policy = RemoteAgentEndpointPolicy::default();

    assert!(validate_endpoint_url("https://agent.example.com/run", policy).is_ok());
    assert!(validate_endpoint_url("http://agent.example.com/run", policy).is_err());
    assert!(validate_endpoint_url("ftp://agent.example.com/run", policy).is_err());
    assert!(validate_endpoint_url("not a url", policy).is_err());
}

#[test]
fn rejects_local_endpoints_under_the_default_policy() {
    let policy = RemoteAgentEndpointPolicy::default();

    assert!(validate_endpoint_url("https://localhost:8443/run", policy).is_err());
    assert!(validate_endpoint_url("https://127.0.0.1/run", policy).is_err());
    assert!(validate_endpoint_url("https://[::1]/run", policy).is_err());
}

#[test]
fn allows_local_endpoints_only_when_configured() {
    let policy = RemoteAgentEndpointPolicy::AllowLocal;

    assert!(validate_endpoint_url("http://localhost:8443/run", policy).is_ok());
    assert!(validate_endpoint_url("https://10.0.0.5/run", policy).is_ok());
}

#[test]
fn reads_the_documented_json_response() {
    let parsed = parse_response(r#"{"output":"the daily digest"}"#);
    assert_eq!(parsed.output, "the daily digest");
}

#[test]
fn falls_back_to_the_raw_body_for_plain_text_agents() {
    let parsed = parse_response("  the daily digest\n");
    assert_eq!(parsed.output, "the daily digest");
}

#[test]
fn truncates_oversized_output_on_a_char_boundary() {
    let body = "é".repeat(MAX_OUTPUT_CHARS + 10);
    let parsed = parse_response(&body);

    assert_eq!(parsed.output.chars().count(), MAX_OUTPUT_CHARS);
}
