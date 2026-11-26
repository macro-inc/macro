# An nginx Deployment with its config, Service and disruption budget, as
# nixidy resources. The edge and the query gateway are both this.
{ lib, workload }:
let
  # nginx 1.30 as on the host, unprivileged (uid 101, listens on a high port).
  # Its image sets STOPSIGNAL SIGQUIT: nginx finishes open requests on stop.
  image = "docker.io/nginxinc/nginx-unprivileged:1.30.6-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03";
  uid = 101;
in
{
  # The parts of nginx.conf both share: no root, temp files under /tmp, logs
  # to the pod's output, `/healthz` answered by nginx itself.
  wrapConfig = http: ''
    worker_processes auto;
    pid /tmp/nginx.pid;
    error_log /dev/stderr warn;
    events {
      worker_connections 1024;
    }
    http {
      client_body_temp_path /tmp/client_body;
      proxy_temp_path /tmp/proxy;
      fastcgi_temp_path /tmp/fastcgi;
      uwsgi_temp_path /tmp/uwsgi;
      scgi_temp_path /tmp/scgi;
      server_tokens off;
      # Backends are resolved per request, so nginx starts even before the
      # Services it proxies to exist, and follows them if they change.
      resolver kube-dns.kube-system.svc.cluster.local valid=30s ipv6=off;
      log_format safe '$remote_addr $host $request_method $uri $status';
      access_log /dev/stdout safe;
    ${http}
    }
  '';

  # `/healthz` for probes and the ALB, inside each server block.
  healthz = ''
    location = /healthz {
      access_log off;
      default_type text/plain;
      return 200 "ok\n";
    }
  '';

  resources =
    {
      name,
      config,
      port,
      podLabels ? { },
      replicas ? 2,
      zones ? null,
      preStopSeconds,
      terminationGracePeriodSeconds ? 30,
      volumes ? [ ],
      volumeMounts ? [ ],
      podAnnotations ? { },
    }:
    let
      selector."app.kubernetes.io/name" = name;
    in
    {
      configMaps.${name}.data."nginx.conf" = config;

      deployments.${name} = {
        metadata.labels = selector;
        spec = {
          inherit replicas;
          selector.matchLabels = selector;
          strategy = workload.surgeOne;
          template = {
            metadata = {
              labels = selector // podLabels;
              annotations = {
                "checksum/config" = workload.checksum config;
              }
              // podAnnotations;
            };
            spec = {
              automountServiceAccountToken = false;
              enableServiceLinks = false;
              inherit terminationGracePeriodSeconds;
              securityContext = workload.podSecurity uid;
              topologySpreadConstraints = workload.spread selector;
              affinity = lib.mkIf (zones != null) (workload.zoneAffinity zones);
              containers = [
                {
                  name = "nginx";
                  inherit image;
                  # Straight to nginx: the image's entrypoint scripts rewrite
                  # files under /etc/nginx, which is read-only here.
                  command = [
                    "nginx"
                    "-c"
                    "/etc/nginx/conf/nginx.conf"
                    "-g"
                    "daemon off;"
                  ];
                  ports = [
                    {
                      name = "http";
                      containerPort = port;
                    }
                  ];
                  readinessProbe = {
                    httpGet = {
                      path = "/healthz";
                      port = "http";
                    };
                    periodSeconds = 5;
                    failureThreshold = 2;
                  };
                  livenessProbe = {
                    httpGet = {
                      path = "/healthz";
                      port = "http";
                    };
                    periodSeconds = 10;
                    failureThreshold = 6;
                  };
                  # Keep serving while the endpoint (or target) removal
                  # reaches every client, then drain.
                  lifecycle.preStop.sleep.seconds = preStopSeconds;
                  resources = {
                    requests = {
                      cpu = "50m";
                      memory = "64Mi";
                    };
                    limits.memory = "256Mi";
                  };
                  securityContext = workload.containerSecurity;
                  volumeMounts = [
                    {
                      name = "config";
                      mountPath = "/etc/nginx/conf";
                      readOnly = true;
                    }
                    {
                      name = "tmp";
                      mountPath = "/tmp";
                    }
                  ]
                  ++ volumeMounts;
                }
              ];
              volumes = [
                {
                  name = "config";
                  configMap.name = name;
                }
                {
                  name = "tmp";
                  emptyDir = { };
                }
              ]
              ++ volumes;
            };
          };
        };
      };

      services.${name} = {
        metadata.labels = selector;
        spec = {
          inherit selector;
          ports = [
            {
              name = "http";
              inherit port;
              targetPort = "http";
            }
          ];
        };
      };

      podDisruptionBudgets.${name}.spec = {
        maxUnavailable = 1;
        selector.matchLabels = selector;
      };
    };
}
