# The guest as a Docker container for the dev-only DockerFleet: systemd as
# PID 1, enrollment from a bind-mounted file, Docker owns the network.
{ lib, ... }:
{
  imports = [ ./_guest.nix ];

  boot.isContainer = true;
  macro.box.enrollFrom = "file:/run/macro/enrollment.json";
  # A Docker guest is recreated rather than updated.
  macro.box.dataDisk = null;
  networking.useNetworkd = lib.mkForce false;
  networking.useDHCP = false;
  services.resolved.enable = false;
  # Docker bind-mounts its own resolv.conf.
  networking.resolvconf.enable = false;
}
