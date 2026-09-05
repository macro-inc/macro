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
    'AuthorizedKeysFile /run/ssh-authorized-keys/%u' \
    'AllowTcpForwarding remote' \
    'GatewayPorts clientspecified' \
    'PidFile /run/sshd.pid' \
    > /etc/ssh/sshd_config

# Bind-mounted keys retain the host UID, which may differ from the container
# account. Copy into a root-owned directory so sshd's StrictModes check passes.
CMD ["sh", "-c", "mkdir -p /run/ssh-authorized-keys && chmod 755 /run/ssh-authorized-keys && cp /etc/ssh/authorized_keys/sdk-webhook /run/ssh-authorized-keys/sdk-webhook && chown root:root /run/ssh-authorized-keys/sdk-webhook && chmod 644 /run/ssh-authorized-keys/sdk-webhook && ssh-keygen -A && exec /usr/sbin/sshd -D -e"]
