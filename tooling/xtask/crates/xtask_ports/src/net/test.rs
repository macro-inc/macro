use super::*;

#[test]
fn routes_parse_from_the_kernel_table_without_the_default_route() {
    let table = "Iface\tDestination\tGateway\tFlags\tRefCnt\tUse\tMetric\tMask\tMTU\tWindow\tIRTT\n\
                 ens3\t00000000\t01008E0A\t0003\t0\t0\t100\t00000000\t0\t0\t0\n\
                 tun0\t00C8FE0A\t00000000\t0001\t0\t0\t0\t00FFFFFF\t0\t0\t0\n";

    assert_eq!(
        parse_routes(table),
        vec![Ipv4Range::parse("10.254.200.0/24").unwrap()]
    );
}

#[test]
fn a_short_or_garbled_route_row_is_skipped() {
    let table = "Iface\tDestination\n\
                 tun0\tnothex\t00000000\t0001\t0\t0\t0\t00FFFFFF\n\
                 tun1\t00C8FE0A\n";

    assert!(parse_routes(table).is_empty());
}

#[test]
fn ranges_overlap_only_when_they_share_an_address() {
    let block = block_range(9);

    assert!(block.overlaps(Ipv4Range::parse("10.254.9.192/26").unwrap()));
    assert!(block.overlaps(Ipv4Range::parse("10.0.0.0/8").unwrap()));
    assert!(!block.overlaps(Ipv4Range::parse("10.254.10.0/24").unwrap()));
}

#[test]
fn ipv6_and_bad_prefixes_are_not_ranges() {
    assert_eq!(Ipv4Range::parse("fd00::/64"), None);
    assert_eq!(Ipv4Range::parse("10.0.0.0/33"), None);
    assert_eq!(Ipv4Range::parse("10.0.0.0"), None);
}
