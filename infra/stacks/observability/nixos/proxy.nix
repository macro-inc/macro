# nginx in front of GoAlert: the ALB's only target on this host.
{ ... }:
let
  # TLS ends at the ALB; GoAlert redirects plain-HTTP requests without this.
  goalertProxy = ''
    proxy_pass http://127.0.0.1:3030;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Forwarded-For $remote_addr;
  '';
  # Unauthenticated paging endpoints. GoAlert checks the integration key on each.
  pagingIngress = ''
    limit_except POST { deny all; }
    limit_req zone=paging burst=50 nodelay;
    limit_req_status 429;
    ${goalertProxy}
  '';
in
{
  services.nginx = {
    enable = true;
    # The on-call hostname arrives through validated EC2 metadata. The native
    # unit runs nginx -t after bootstrap has written this runtime include.
    validateConfigFile = false;
    clientMaxBodySize = "8m";
    commonHttpConfig = ''
      log_format safe '$remote_addr $host $request_method $uri $status';
      access_log syslog:server=unix:/dev/log,facility=local7,tag=nginx_access,severity=info safe;
      limit_req_zone $server_name zone=paging:1m rate=20r/s;
      map $http_upgrade $connection_upgrade { default upgrade; ''' close; }
      include /opt/observability/oncall-server.conf;
    '';
    # Any other hostname: only the target group's health check, which arrives
    # without the on-call host.
    virtualHosts.public = {
      listen = [
        {
          addr = "0.0.0.0";
          port = 8080;
        }
      ];
      default = true;
      serverName = "_";
      extraConfig = "add_header Strict-Transport-Security 'max-age=31536000' always;";
      locations = {
        "= /goalert-healthz" = {
          proxyPass = "http://127.0.0.1:3030/health";
          extraConfig = "access_log off; proxy_set_header X-Forwarded-Proto https;";
        };
        "/".return = "404";
      };
    };
  };
  # Included by the runtime on-call server block, which carries the hostname.
  environment.etc."nginx/oncall-locations.conf".text = ''
    add_header Strict-Transport-Security 'max-age=31536000' always;
    location = /health {
      access_log off;
      limit_except GET { deny all; }
      ${goalertProxy}
    }
    location ^~ /api/v2/generic/incoming { ${pagingIngress} }
    location ^~ /api/v2/heartbeat/ { ${pagingIngress} }
    # The observability cluster's Grafana pages through here.
    location = /api/v2/grafana/incoming { ${pagingIngress} }
    # Other inbound integrations, and the rest of Grafana's, are unused.
    location ~ ^/(api/v2/(grafana|prometheusalertmanager|site24x7|mailgun|uik|twilio)|v1/webhooks|health/) {
      return 404;
    }
    location / {
      ${goalertProxy}
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
    }
  '';
  systemd.services.nginx.serviceConfig.MemoryMax = "256M";
}
