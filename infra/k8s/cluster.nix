{ pkgs }:
checkout:
pkgs.writeText "macro-kind.json" (
  builtins.toJSON {
    kind = "Cluster";
    apiVersion = "kind.x-k8s.io/v1alpha4";
    kubeadmConfigPatches = [
      ''
        kind: KubeletConfiguration
        maxPods: 250
      ''
    ];
    networking = {
      podSubnet = "10.253.0.0/16";
      serviceSubnet = "10.254.0.0/16";
    };
    nodes = [
      {
        role = "control-plane";
        # cAdvisor 1.36 cannot read this host's ZFS-backed Docker rootfs.
        image = "kindest/node:v1.35.5@sha256:ce977ae6d65918d0b58a5f8b5e940429c2ce42fa3a5619ec2bbc60b949c0ac95";
        extraMounts = [
          {
            hostPath = checkout;
            containerPath = checkout;
          }
          {
            hostPath = "/nix/store";
            containerPath = "/nix/store";
            readOnly = true;
          }
          {
            hostPath = "/var/run/docker.sock";
            containerPath = "/var/run/docker.sock";
          }
        ];
        extraPortMappings = [
          {
            containerPort = 30443;
            hostPort = 32443;
            listenAddress = "0.0.0.0";
          }
          {
            containerPort = 30444;
            hostPort = 32444;
            listenAddress = "0.0.0.0";
          }
        ];
      }
    ];
  }
)
