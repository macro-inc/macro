FROM alpine:3.22

RUN apk add --no-cache openssh-server \
    && adduser -D -H -s /sbin/nologin sdk-webhook \
    && passwd -d sdk-webhook \
    && mkdir -p /etc/ssh/authorized_keys \
    && chmod 755 /etc/ssh/authorized_keys

RUN printf '%s\n' \
    'Port 22' \
    'PermitRootLogin no' \
    'PasswordAuthentication no' \
    'KbdInteractiveAuthentication no' \
    'PubkeyAuthentication yes' \
    'AuthorizedKeysFile /etc/ssh/authorized_keys/%u' \
    'AllowTcpForwarding remote' \
    'GatewayPorts clientspecified' \
    'PidFile /run/sshd.pid' \
    > /etc/ssh/sshd_config

CMD ["sh", "-c", "ssh-keygen -A && exec /usr/sbin/sshd -D -e"]
