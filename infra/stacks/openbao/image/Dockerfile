# OpenBao with the AWS KMS seal plugin baked in, so the server downloads
# nothing at startup. Both images are pinned by digest; on a version bump,
# update them together with KMS_AWS_PLUGIN_SHA256 in ../server-config.ts
# (README "Image").

# openbao/openbao-plugins release kms-aws-v0.1.1. The image is FROM scratch
# and holds only /openbao-plugin-kms-aws.
FROM ghcr.io/openbao/openbao-plugin-kms-aws:v0.1.1@sha256:24a0a1294385a34224848d0d6ff2c9287f9c9b0ded1de953cc539dc76ced160c AS kms-aws

FROM quay.io/openbao/openbao:2.7.2@sha256:5046911075e137e154ce49ab051502f4ec7cf367d484ae4a4dce665d9b90561f

# Root-owned and read-only: the server only executes it. The upstream layer
# ships it 0644. OpenBao checks its sha256 before every launch.
COPY --from=kms-aws --chmod=0555 /openbao-plugin-kms-aws /usr/lib/openbao/plugins/openbao-plugin-kms-aws
