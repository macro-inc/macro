# A k3s node on NixOS: the same runtime on every environment, differing only in
# role and scale. Mirrors big-pickle's k3s.nix; AWS nodes (infra/platform/aws)
# join a three-server embedded-etcd control plane. Images are ordinary OCI
# images in `registry`.
{
  role,
  serverAddress ? null,
  clusterInit ? false,
}:
{ config, pkgs, ... }:
{
  services.k3s = {
    enable = true;
    inherit role clusterInit;
    tokenFile = "/run/keys/k3s-token";
    serverAddr = if serverAddress != null then "https://${serverAddress}:6443" else "";
    extraFlags = [
      "--kubelet-arg=registry-qps=0"
      "--kubelet-arg=serialize-image-pulls=false"
    ]
    ++ (
      if role == "server" then
        [
          "--disable=traefik"
          "--disable=servicelb"
          "--disable=metrics-server"
          "--cluster-cidr=10.42.0.0/16"
          "--service-cidr=10.43.0.0/16"
          "--kube-proxy-arg=nodeport-addresses=127.0.0.1/32"
        ]
      else
        [ ]
    );
  };

  networking.dhcpcd.denyInterfaces = [
    "flannel*"
    "cni*"
    "veth*"
  ];
  networking.firewall = {
    trustedInterfaces = [
      "cni0"
      "flannel.1"
    ];
    allowedTCPPorts = [
      6443 # API server
      2379 # etcd
      2380
      10250 # kubelet
      443 # ingress (NLB)
    ];
    allowedUDPPorts = [ 8472 ]; # flannel VXLAN
  };
  environment.systemPackages = [ pkgs.kubectl ];
  system.stateVersion = "26.05";
}
