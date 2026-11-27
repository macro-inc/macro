# Hosted Passwords provisioning (dev)

Provision one team in the hosted dev OpenBao. Run this only for teams you mean
to enable; creating a Macro team does not create its namespace. Runs are
idempotent: a repeat run keeps existing values and versions and reapplies the
mounts, policies, and roles. Each run first applies the root-level setup
(`bootstrap_root`, below), then the team.

## Root bootstrap and the scoped provisioner

`bootstrap_root` (root token, every `provision.py` run) sets the
`x-macro-audit-id` audit header, the `macro-lifecycle` JWT mount and its
templated `passwords-lifecycle` policy (each team's lifecycle token may read and
delete only `team-<its team_id claim>`), and, given `--provisioner-public-key`
and `--provisioner-issuer`, the scoped provisioner's identity: JWT mount
`macro-provisioner`, role `provisioner`, and root policy `openbao-provisioner`.

That policy (`render_provisioner_policy`) lets the provisioner create `team-*`
namespaces and set up their mounts, JWT auth, policy, and roles with every
parameter pinned, including the trusted public keys and issuer. It cannot read
or write values, delete anything, or write root policies. `+/` matches every
child namespace, so root must hold only `team-*` children. OpenBao 2.7.2 matches
a list parameter only against a whole allowed list, and never matches JSON
numbers, so the policy pins nested lists and the provisioning sends numbers as
strings.

The provisioner calls `provision_team(..., overwrite=False)`: it creates only
what is missing (the lifecycle role before the namespace, so every namespace is
erasable), verifies what exists, and raises `Incompatible` without writing when
something differs. Operators' runs use `overwrite=True`. Fixture tests:
"Provisioner fixture tests" below.

Once per environment, the document storage service's dev Doppler config
(`cloud-storage-service/dev`) must hold `OPENBAO_ADDRESS`,
`PASSWORDS_JWT_ISSUER`, and `PASSWORDS_JWT_SIGNING_KEY`, set together because
the service refuses a partial set. The signing key is generated the way the
local stack does it, and never printed:

```sh
umask 077
key=$(mktemp)
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$key" &&
jq -n --rawfile key "$key" '{OPENBAO_ADDRESS: "https://openbao-dev.macro-internal.com",
  PASSWORDS_JWT_ISSUER: "macro-dev-passwords", PASSWORDS_JWT_SIGNING_KEY: $key}' \
  | doppler secrets upload -p cloud-storage-service -c dev /dev/stdin > /dev/null
shred -u "$key"
```

Rotating the key interrupts Passwords for every provisioned team. Each team's
roles trust exactly one public key, and the service reads the signing key only
at startup. Rotate in this order:

1. Upload the new key with the block above.
2. Re-run the provisioning below for every provisioned team, with
   `--provisioner-public-key` and `--provisioner-issuer` on the first run so the
   provisioner policy pins the new key. Until it does, the provisioner can't set
   up new teams (its writes of the new key are denied). From each team's run
   until step 3 ends, that team's vault requests fail.
3. Restart the document storage service so it signs with the new key.

When the roles trust several keys during a switch, render the provisioner
policy with that exact list (old and new), then again with only the new key once
the old one is retired.

## Provisioning one team

1. Open the [operator tunnel](../stacks/openbao/README.md#operator-tunnel).
   It listens on local port 18443.
2. Derive the public key and read the issuer from the document storage
   service's dev Doppler config. Only the public half is written to disk:

   ```sh
   umask 077
   public_key=$(mktemp)
   doppler secrets get PASSWORDS_JWT_SIGNING_KEY -p cloud-storage-service -c dev --plain \
     | openssl pkey -pubout > "$public_key"
   issuer=$(doppler secrets get PASSWORDS_JWT_ISSUER -p cloud-storage-service -c dev --plain)
   ```

3. Run the provisioning with the root token from Doppler `openbao/dev`, passed
   in the environment only:

   ```sh
   doppler run -p openbao -c dev --only-secrets OPENBAO_ROOT_TOKEN -- \
     sh -c 'BAO_TOKEN="$OPENBAO_ROOT_TOKEN" exec python3 infra/openbao/provision.py \
       --connect 127.0.0.1:18443 --team-id "$0" \
       --jwt-public-key "$1" --jwt-issuer "$2"' \
     <team-uuid> "$public_key" "$issuer"
   rm "$public_key"
   ```

It prints only the namespace it provisioned. The roles disable JWT clock
leeway, so the document storage service and the vault must keep synchronized
clocks (both run on Fargate with Amazon Time Sync).

## Provisioner fixture tests

`test_provisioner_fixture.py` runs the scoped provisioner against a disposable
OpenBao 2.7.2, through its real JWT login. The dev server can't enable audit
devices by API, so declare the redacting one in a config file:

```sh
printf 'audit "file" "passwords" {\n  options {\n    file_path = "stdout"\n    log_raw = "false"\n  }\n}\n' > audit.hcl
docker run -d --name <fixture> -p 127.0.0.1:<port>:8200 -v "$PWD/audit.hcl:/fixture/audit.hcl:ro" \
  -e BAO_DEV_ROOT_TOKEN_ID=root quay.io/openbao/openbao:2.7.2 \
  server -dev -dev-listen-address=0.0.0.0:8200 -config=/fixture/audit.hcl
OPENBAO_FIXTURE_ADDRESS=http://127.0.0.1:<port> OPENBAO_FIXTURE_ROOT_TOKEN=root \
  python3 -m unittest discover -s infra/openbao -p 'test_provisioner_fixture.py'
```

Remove the container afterwards.
