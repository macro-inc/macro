# Cursor Cloud Agent base image for the Macro local stack.
#
# OS-level deps only. Do not COPY the repository: Cursor checks out the
# requested revision separately. The Rust/JS toolchain (just, cargo 1.94.0,
# bun, sqlx-cli, zig/cargo-zigbuild) comes from `nix develop` (flake.nix).
#
# Nested Docker (DinD) requires fuse-overlayfs + iptables-legacy. Docker 29
# also needs the containerd snapshotter disabled or overlay mounts fail.
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive \
    USER=ubuntu \
    HOME=/home/ubuntu \
    PATH="/home/ubuntu/.nix-profile/bin:/nix/var/nix/profiles/default/bin:${PATH}"

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates \
        curl \
        git \
        gnupg \
        iptables \
        iproute2 \
        kmod \
        fuse-overlayfs \
        procps \
        python3 \
        sudo \
        xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Docker CE 29 (compose plugin + buildx). Pin matches the working Cloud Agent
# VM; Docker 29 requires features.containerd-snapshotter=false below.
RUN install -m 0755 -d /etc/apt/keyrings \
    && curl --retry 3 --retry-delay 5 -fsSL https://download.docker.com/linux/ubuntu/gpg \
        | gpg --dearmor -o /etc/apt/keyrings/docker.gpg \
    && chmod a+r /etc/apt/keyrings/docker.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
        $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
        > /etc/apt/sources.list.d/docker.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends \
        docker-ce=5:29.7.2-1~ubuntu.24.04~noble \
        docker-ce-cli=5:29.7.2-1~ubuntu.24.04~noble \
        containerd.io \
        docker-buildx-plugin \
        docker-compose-plugin \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /etc/docker \
    && printf '%s\n' \
        '{' \
        '  "storage-driver": "fuse-overlayfs",' \
        '  "features": {' \
        '    "containerd-snapshotter": false' \
        '  }' \
        '}' > /etc/docker/daemon.json \
    && update-alternatives --set iptables /usr/sbin/iptables-legacy \
    && update-alternatives --set ip6tables /usr/sbin/ip6tables-legacy

# Cloud Agents have no systemd (init is tini). ubuntu is UID 1000 on this image.
RUN id -u ubuntu >/dev/null 2>&1 || useradd -m -s /bin/bash ubuntu \
    && groupadd -f docker \
    && usermod -aG docker ubuntu \
    && usermod -aG sudo ubuntu \
    && echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu \
    && chmod 0440 /etc/sudoers.d/ubuntu

# Determinate Nix, no init. sandbox=false is required inside the build container.
# ubuntu is a trusted-user so later `nix develop` can talk to nix-daemon.
RUN curl -fsSL https://install.determinate.systems/nix | sh -s -- install linux \
        --init none \
        --no-confirm \
        --extra-conf "trusted-users = root ubuntu" \
        --extra-conf "sandbox = false" \
    && ln -sf /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh /etc/profile.d/nix-daemon.sh

# Nix openssh in the ubuntu profile. `just stack up` shells out to ssh-keygen;
# the Cloud Agent /exec-daemon/ssh-keygen shim crashes under nix develop's
# LD_LIBRARY_PATH (glibc 2.42 vs system 2.39).
USER ubuntu
WORKDIR /home/ubuntu
RUN . /nix/var/nix/profiles/default/etc/profile.d/nix-daemon.sh \
    && sudo /nix/var/nix/profiles/default/bin/nix-daemon >/tmp/nix-daemon-build.log 2>&1 & \
    for i in $(seq 1 60); do \
        [ -S /nix/var/nix/daemon-socket/socket ] && break; \
        sleep 1; \
    done \
    && [ -S /nix/var/nix/daemon-socket/socket ] \
    && nix profile add nixpkgs#openssh
