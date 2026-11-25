# Private subnets in us-east-2b and 2c. They route through the existing private
# route table: the stack's single NAT and its S3 gateway endpoint.
{ lib, settings, ... }:
let
  inherit (lib.tf) ref;
  subnet = zone: cidr: {
    vpc_id = ref "data.aws_vpc.observability.id";
    availability_zone = "${settings.region}${zone}";
    cidr_block = cidr;
    map_public_ip_on_launch = false;
    tags.Name = "observability-k8s-private-${zone}";
  };
  association = zone: {
    subnet_id = ref "aws_subnet.private_${zone}.id";
    route_table_id = ref "data.aws_route_table.private.id";
  };
in
{
  resource.aws_subnet = lib.mapAttrs' (
    zone: cidr: lib.nameValuePair "private_${zone}" (subnet zone cidr)
  ) settings.privateSubnets;

  resource.aws_route_table_association = lib.mapAttrs' (
    zone: _: lib.nameValuePair "private_${zone}" (association zone)
  ) settings.privateSubnets;
}
