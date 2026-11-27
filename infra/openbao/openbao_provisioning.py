"""Passwords team provisioning shared by the local bootstrap and hosted OpenBao.

The local entrypoint is `infra/local/openbao/bootstrap.py` (loopback HTTP only);
the hosted one is `provision.py` next to this module (one exact HTTPS origin).
Each entrypoint owns its origin guard; this module never chooses an address.

`bootstrap_root` runs once per vault with the root token. `provision_team` sets
up one team; with `overwrite=False` (the scoped provisioner's path) it creates
only what is missing, verifies what exists, and never writes to a healthy team.
"""

from dataclasses import dataclass, field
import json
import time
from urllib.error import HTTPError
from urllib.request import HTTPRedirectHandler, Request

SERVICE_POLICY = '\n'.join((
    'path "passwords/data/*" { capabilities = ["create", "read", "update"] }',
    'path "passwords/metadata/*" { capabilities = ["read"] }',
    'path "passwords/destroy/*" { capabilities = ["update"] }',
    'path "totp/keys/*" { capabilities = ["create", "update", "delete"] }',
    'path "totp/code/*" { capabilities = ["read"] }',
))
LIFECYCLE_MOUNT = "macro-lifecycle"
LIFECYCLE_POLICY = "passwords-lifecycle"
PROVISIONER_MOUNT = "macro-provisioner"
PROVISIONER_ROLE = "provisioner"
PROVISIONER_POLICY = "openbao-provisioner"
PROVISIONER_SUBJECT = "macro-openbao-provisioner"
KV_CONFIG = {"max_versions": "100", "cas_required": True}
# OpenBao 2.7.2 `allowed_parameters` never matches JSON numbers, so the scoped
# provisioner sends every number as a string (OpenBao parses both forms).
NO_LEEWAY = {"clock_skew_leeway": "-1", "expiration_leeway": "-1", "not_before_leeway": "-1"}
SHORT_TOKEN = {"token_no_default_policy": True, "token_ttl": "60s", "token_max_ttl": "60s", "token_explicit_max_ttl": "60s"}
RETRY_DELAYS = [min(0.05 * 2 ** attempt, 0.5) for attempt in range(8)]


class OpenBaoRequestError(RuntimeError):
    """Sanitized provider failure, with status available for readiness checks."""
    def __init__(self, method, path, status, reason=""):
        self.status = status
        # `reason` is OpenBao's own error text for 400s (never a request or
        # response value); callers match on it to recognize races.
        self.reason = reason
        super().__init__(f"OpenBao {method} {path}: HTTP {status}")


class Incompatible(ValueError):
    """An existing piece of team setup differs from the declared one; nothing was changed."""
    def __init__(self, namespace, piece):
        self.piece = piece
        super().__init__(f"incompatible existing {piece} in {namespace}")


class DeadlineExceeded(RuntimeError):
    """The caller's deadline passed before the namespace was created; nothing was created."""
    def __init__(self, namespace):
        super().__init__(f"deadline passed before creating {namespace}")


class NamespaceBusy(RuntimeError):
    """The namespace stayed mid-creation or mid-deletion past the retry bound."""
    def __init__(self, namespace):
        super().__init__(f"namespace {namespace} is being created or deleted")


@dataclass
class ProvisionResult:
    namespace: str
    created_pieces: list = field(default_factory=list)

    @property
    def created(self):
        """True when this call wrote anything; a healthy team gives False."""
        return bool(self.created_pieces)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, request, response, code, message, headers, new_url):
        raise ValueError("OpenBao redirects are forbidden")


class OpenBaoClient:
    """Minimal OpenBao HTTP client; callers choose and validate the origin."""
    def __init__(self, address, token, opener, audit_id=None):
        self.address = address.rstrip("/")
        self.token = token
        self.audit_id = audit_id
        self.opener = opener

    def request(self, method, path, data=None, namespace=None, missing=False):
        headers = {"X-Vault-Token": self.token, "Content-Type": "application/json"}
        if self.audit_id:
            headers["x-macro-audit-id"] = self.audit_id
        if namespace:
            headers["X-Vault-Namespace"] = namespace
        body = None if data is None else json.dumps(data).encode()
        request = Request(f"{self.address}/v1/{path}", body, headers, method=method)
        try:
            with self.opener.open(request, timeout=10) as response:
                content = response.read(1024 * 1024)
                return json.loads(content) if content else {}
        except HTTPError as error:
            reason = ""
            if error.code == 400:
                try:
                    reason = " ".join(json.loads(error.read(64 * 1024)).get("errors", []))
                except (ValueError, AttributeError):
                    pass
            error.close()
            if missing and error.code == 404:
                return None
            # Never print request/response bodies, tokens, JWTs, or secret values.
            raise OpenBaoRequestError(method, path, error.code, reason) from None


def configure_kv(client, namespace, newly_mounted, mount="passwords"):
    # The KV v2 plugin may still be initializing after sys/mounts acknowledges it.
    # Retry only a newly mounted backend's temporary 400, never an existing config.
    for attempt in range(8):
        try:
            client.request("POST", f"{mount}/config", KV_CONFIG, namespace)
            return
        except OpenBaoRequestError as error:
            if not newly_mounted or error.status != 400 or attempt == 7:
                raise
            time.sleep(RETRY_DELAYS[attempt])


def pem(key):
    """OpenBao returns stored PEMs without the trailing newline; compare and send them that way."""
    return key.strip()


def require_redacting_audit(client):
    audits = client.request("GET", "sys/audit")["data"]
    if "passwords/" not in audits:
        raise ValueError("OpenBao must declare the passwords audit device in its server config")
    if audits["passwords/"]["options"].get("log_raw") != "false":
        raise ValueError("Password audit device must redact sensitive values")


def jwt_config(public_keys, issuer, algorithms):
    return {
        "jwt_validation_pubkeys": [pem(key) for key in public_keys],
        "bound_issuer": issuer,
        "jwt_supported_algs": list(algorithms),
    }


def service_role(team_id):
    return {
        "role_type": "jwt",
        "user_claim": "sub",
        "bound_subject": "macro-passwords-service",
        "bound_audiences": ["macro-passwords"],
        "bound_claims": {"team_id": str(team_id)},
        "claim_mappings": {"audit_id": "audit_id"},
        **NO_LEEWAY,
        "token_policies": ["passwords-service"],
        **SHORT_TOKEN,
    }


def lifecycle_role(team_id):
    # `user_claim=team_id` makes the team ID the entity alias name, which the
    # templated `passwords-lifecycle` policy turns into the one deletable namespace.
    return {
        "role_type": "jwt",
        "user_claim": "team_id",
        "bound_subject": "macro-passwords-lifecycle",
        "bound_audiences": ["macro-passwords-lifecycle"],
        "bound_claims": {"team_id": str(team_id)},
        "claim_mappings": {"audit_id": "audit_id"},
        **NO_LEEWAY,
        "token_policies": [LIFECYCLE_POLICY],
        **SHORT_TOKEN,
    }


def provisioner_role():
    return {
        "role_type": "jwt",
        "user_claim": "sub",
        "bound_subject": PROVISIONER_SUBJECT,
        "bound_audiences": [PROVISIONER_SUBJECT],
        **NO_LEEWAY,
        "token_policies": [PROVISIONER_POLICY],
        **SHORT_TOKEN,
    }


def ttl_seconds(value):
    return int(value[:-1]) if isinstance(value, str) and value.endswith("s") else int(value)


def role_matches(actual, expected):
    """Compare a role read back from OpenBao with the declared one, field by field."""
    if actual.get("token_period") or actual.get("token_num_uses") or actual.get("token_bound_cidrs"):
        return False
    for key, value in expected.items():
        if key.endswith("_ttl"):
            value = ttl_seconds(value)
        elif key.endswith("_leeway"):
            value = int(value)
        if actual.get(key) != value:
            return False
    return True


def config_matches(actual, expected):
    if actual.get("oidc_discovery_url") or actual.get("jwks_url") or actual.get("provider_config"):
        return False
    return (
        [pem(key) for key in actual.get("jwt_validation_pubkeys") or []] == expected["jwt_validation_pubkeys"]
        and actual.get("bound_issuer") == expected["bound_issuer"]
        and list(actual.get("jwt_supported_algs") or []) == expected["jwt_supported_algs"]
    )


def kv_config_state(config):
    if config.get("max_versions") == 0 and not config.get("cas_required"):
        return "missing"
    if config.get("max_versions") == int(KV_CONFIG["max_versions"]) and config.get("cas_required") is True:
        return "ok"
    return "differs"


class TeamSetup:
    """Reads and writes each piece of one team's setup; `run` applies or only inspects."""

    def __init__(self, client, team_id, public_keys, issuer, algorithms):
        self.client = client
        self.team_id = team_id
        self.namespace = f"team-{team_id}"
        self.config = jwt_config(public_keys, issuer, algorithms)

    def get(self, path, namespace=None, retry_400=False):
        for attempt, delay in enumerate(RETRY_DELAYS):
            try:
                return self.client.request("GET", path, namespace=namespace, missing=True)
            except OpenBaoRequestError as error:
                # A mount another caller just enabled may still be initializing (400),
                # and reads racing concurrent writes can briefly fail (5xx).
                transient = error.status >= 500 or (retry_400 and error.status == 400)
                if not transient or attempt == len(RETRY_DELAYS) - 1:
                    raise
                time.sleep(delay)

    def namespace_state(self):
        found = self.get(f"sys/namespaces/{self.namespace}")
        if found is None:
            return "missing"
        return "busy" if found.get("data", {}).get("tainted") else "ok"

    def create_namespace(self, deadline):
        for delay in RETRY_DELAYS:
            state = self.namespace_state()
            if state == "ok":
                return False
            if state == "missing":
                if deadline is not None and time.time() >= deadline:
                    raise DeadlineExceeded(self.namespace)
                try:
                    self.client.request("POST", f"sys/namespaces/{self.namespace}", {})
                    return True
                except OpenBaoRequestError as error:
                    # Another caller is creating it (or it is being deleted): re-read.
                    if error.status != 400 or "being created or deleted" not in error.reason:
                        raise
            time.sleep(delay)
        raise NamespaceBusy(self.namespace)

    def enable(self, kind_path, path, body):
        """Enable a mount or auth method; a concurrent caller's identical one is fine."""
        try:
            self.client.request("POST", f"{kind_path}/{path}", body, self.namespace)
            return True
        except OpenBaoRequestError as error:
            if error.status != 400 or "already in use" not in error.reason:
                raise
            return False

    def write(self, method, path, body, namespace, matches, retry_400=False):
        """Write one piece; returns False if a concurrent caller's identical write won.

        Concurrent writes to one path can fail with a 500 ("transaction commit
        failed"), and a just-mounted KV backend answers 400 while it initializes.
        Either way, re-read: matching means done; otherwise retry within a bound.
        Authorization failures (403) are never retried.
        """
        for attempt, delay in enumerate(RETRY_DELAYS):
            try:
                self.client.request(method, path, body, namespace)
                return True
            except OpenBaoRequestError as error:
                if not (error.status >= 500 or (retry_400 and error.status == 400)):
                    raise
                found = self.get(path, namespace, retry_400=retry_400)
                if found and found.get("data") and matches(found["data"]):
                    return False
                if attempt == len(RETRY_DELAYS) - 1:
                    raise
                time.sleep(delay)

    def run(self, apply, overwrite, deadline=None):
        """Returns (state, created pieces). `apply=False` never writes."""
        created = []
        ns = self.namespace

        state = self.namespace_state()
        if state == "busy" and not apply:
            raise NamespaceBusy(ns)
        if state == "missing" and not apply:
            # A lifecycle role alone is not a vault: purge has nothing to erase.
            return "absent", created
        # The lifecycle role comes first, so any namespace that exists can always
        # be erased by the document storage service's purge.
        lifecycle = self.piece("lifecycle role", f"auth/{LIFECYCLE_MOUNT}/role/{ns}", None,
                               lifecycle_role(self.team_id), "POST", apply, overwrite)
        if lifecycle == "partial":
            return "partial", created
        if lifecycle == "created":
            created.append("lifecycle role")
        # A namespace another caller is still creating reads as busy: wait for it.
        if state != "ok" and self.create_namespace(deadline):
            created.append("namespace")
        partial = False

        mounts = self.get("sys/mounts", ns)["data"]
        for path, kind, options in (("passwords", "kv", {"version": "2"}), ("totp", "totp", {})):
            existing = mounts.get(path + "/")
            if existing and (existing["type"] != kind or (kind == "kv" and existing["options"].get("version") != "2")):
                raise Incompatible(ns, f"{path} mount")
            if not existing:
                partial = True
                if apply and self.enable("sys/mounts", path, {"type": kind, "options": options}):
                    created.append(f"{path} mount")
        if not apply and partial:
            return "partial", created
        if apply and partial:
            # Re-read: a concurrent caller may have won, with a different type.
            mounts = self.get("sys/mounts", ns)["data"]
            for path, kind in (("passwords", "kv"), ("totp", "totp")):
                if mounts.get(path + "/", {}).get("type") != kind:
                    raise Incompatible(ns, f"{path} mount")

        kv = self.get("passwords/config", ns, retry_400=True)
        kv_state = kv_config_state((kv or {}).get("data") or {})
        if kv_state == "differs" and not overwrite:
            raise Incompatible(ns, "passwords KV config")
        if kv_state != "ok":
            if not apply:
                return "partial", created
            if self.write("POST", "passwords/config", KV_CONFIG, ns,
                          lambda found: kv_config_state(found) == "ok", retry_400=True):
                created.append("passwords KV config")

        auths = self.get("sys/auth", ns)["data"]
        existing = auths.get("macro/")
        if existing and existing["type"] != "jwt":
            raise Incompatible(ns, "macro auth mount")
        if not existing:
            if not apply:
                return "partial", created
            if self.enable("sys/auth", "macro", {"type": "jwt"}):
                created.append("macro auth mount")
            elif self.get("sys/auth", ns)["data"].get("macro/", {}).get("type") != "jwt":
                raise Incompatible(ns, "macro auth mount")

        for name, path, body, method in (
            ("JWT config", "auth/macro/config", self.config, "POST"),
            ("passwords-service policy", "sys/policies/acl/passwords-service", {"policy": SERVICE_POLICY}, "PUT"),
            ("passwords-service role", "auth/macro/role/passwords-service", service_role(self.team_id), "POST"),
        ):
            outcome = self.piece(name, path, ns, body, method, apply, overwrite)
            if outcome == "partial":
                return "partial", created
            if outcome == "created":
                created.append(name)
        return "ready", created

    def piece(self, name, path, namespace, body, method, apply, overwrite):
        """Create-if-missing one config, policy, or role: "ok", "created", "kept", or "partial"."""
        if "policy" in body:
            matches = lambda found: found.get("policy") == body["policy"]
        elif "jwt_validation_pubkeys" in body:
            matches = lambda found: config_matches(found, body)
        else:
            matches = lambda found: role_matches(found, body)
        found = self.get(path, namespace)
        data = (found or {}).get("data")
        if data and matches(data):
            return "ok"
        if data and not overwrite:
            raise Incompatible(self.namespace, name)
        if not apply:
            return "partial"
        return "created" if self.write(method, path, body, namespace, matches) else "kept"


def provision_team(client, team_id, public_keys, issuer, algorithms, *, overwrite, deadline=None):
    """Set up one team namespace; never deletes or replaces values.

    `overwrite=False` creates only what is missing and raises `Incompatible`
    for anything that differs, so a healthy team gets no writes. `overwrite=True`
    (operators, key rotation) re-applies the JWT config, policy, and roles.
    `deadline` (Unix seconds) is checked right before the namespace is created.
    """
    require_redacting_audit(client)
    setup = TeamSetup(client, team_id, public_keys, issuer, algorithms)
    _, created = setup.run(apply=True, overwrite=overwrite, deadline=deadline)
    return ProvisionResult(setup.namespace, created)


def inspect_team(client, team_id, public_keys, issuer, algorithms):
    """Read-only readiness: "absent", "partial", "ready", or "incompatible".

    "absent" means no namespace, even if its lifecycle role exists. Raises
    `NamespaceBusy` while the namespace is mid-creation or mid-deletion."""
    try:
        state, _ = TeamSetup(client, team_id, public_keys, issuer, algorithms).run(apply=False, overwrite=False)
        return state
    except Incompatible:
        return "incompatible"


def hcl_list(values):
    return "[" + ", ".join(json.dumps(value) for value in values) + "]"


def render_provisioner_policy(issuer, public_keys, algorithms):
    """The scoped provisioner's root policy, with the trusted keys and issuer pinned.

    OpenBao 2.7.2 matches a list parameter only against a whole allowed list, so
    lists are pinned nested (`[["a", "b"]]`). A key rotation re-renders this.
    """
    keys = hcl_list([pem(key) for key in public_keys])
    pinned_service_role = (
        '    "role_type" = ["jwt"]\n'
        '    "user_claim" = ["sub"]\n'
        '    "bound_subject" = ["macro-passwords-service"]\n'
        '    "bound_audiences" = [["macro-passwords"]]\n'
        '    "bound_claims" = []\n'
        '    "claim_mappings" = []\n'
        '    "clock_skew_leeway" = ["-1"]\n'
        '    "expiration_leeway" = ["-1"]\n'
        '    "not_before_leeway" = ["-1"]\n'
        '    "token_policies" = [["passwords-service"]]\n'
        '    "token_no_default_policy" = [true]\n'
        '    "token_ttl" = ["60s"]\n'
        '    "token_max_ttl" = ["60s"]\n'
        '    "token_explicit_max_ttl" = ["60s"]\n'
    )
    pinned_lifecycle_role = (pinned_service_role
        .replace('["sub"]', '["team_id"]')
        .replace("macro-passwords-service", "macro-passwords-lifecycle")
        .replace('[["macro-passwords"]]', '[["macro-passwords-lifecycle"]]')
        .replace('[["passwords-service"]]', f'[["{LIFECYCLE_POLICY}"]]'))
    return f'''# Rendered by openbao_provisioning.render_provisioner_policy; do not edit.
# Root may hold only team-* child namespaces: `+/` matches every child.
path "sys/audit" {{ capabilities = ["read", "sudo"] }}
path "sys/namespaces" {{ capabilities = ["list"] }}
# OpenBao 2.7.2 treats every namespace POST as an update, so create alone is denied.
path "sys/namespaces/team-*" {{ capabilities = ["create", "update", "read"] }}
path "auth/{LIFECYCLE_MOUNT}/role/team-*" {{
  capabilities = ["create", "update", "read"]
  allowed_parameters = {{
{pinned_lifecycle_role}  }}
}}
path "+/sys/mounts" {{ capabilities = ["read"] }}
path "+/sys/mounts/passwords" {{
  capabilities = ["create", "update"]
  allowed_parameters = {{ "type" = ["kv"], "options" = [] }}
}}
path "+/sys/mounts/totp" {{
  capabilities = ["create", "update"]
  allowed_parameters = {{ "type" = ["totp"], "options" = [] }}
}}
path "+/passwords/config" {{
  capabilities = ["create", "update", "read"]
  allowed_parameters = {{ "max_versions" = ["100"], "cas_required" = [true] }}
}}
path "+/sys/auth" {{ capabilities = ["read", "sudo"] }}
path "+/sys/auth/macro" {{
  capabilities = ["create", "update", "sudo"]
  allowed_parameters = {{ "type" = ["jwt"] }}
}}
path "+/auth/macro/config" {{
  capabilities = ["create", "update", "read"]
  allowed_parameters = {{
    "jwt_validation_pubkeys" = [{keys}]
    "bound_issuer" = [{json.dumps(issuer)}]
    "jwt_supported_algs" = [{hcl_list(algorithms)}]
  }}
}}
path "+/sys/policies/acl/passwords-service" {{
  capabilities = ["create", "update", "read"]
  allowed_parameters = {{ "policy" = [{json.dumps(SERVICE_POLICY)}] }}
}}
path "+/auth/macro/role/passwords-service" {{
  capabilities = ["create", "update", "read"]
  allowed_parameters = {{
{pinned_service_role}  }}
}}
'''


def ensure_jwt_mount(client, path):
    auths = client.request("GET", "sys/auth")["data"]
    existing = auths.get(path + "/")
    if existing and existing["type"] != "jwt":
        raise ValueError(f"incompatible {path} authentication mount")
    if not existing:
        client.request("POST", f"sys/auth/{path}", {"type": "jwt"})
        existing = client.request("GET", "sys/auth")["data"][path + "/"]
    return existing["accessor"]


def bootstrap_root(client, public_keys, issuer, algorithms, provisioner_public_key=None, provisioner_issuer=None):
    """Root-only, once per vault (root token): audit header, lifecycle and provisioner auth.

    Idempotent; re-run it on a key rotation so the lifecycle mount and the
    provisioner policy trust the new keys. Without a provisioner key it skips
    the provisioner mount, role, and policy and returns False.
    """
    require_redacting_audit(client)
    client.request("POST", "sys/config/auditing/request-headers/x-macro-audit-id", {"hmac": False})
    accessor = ensure_jwt_mount(client, LIFECYCLE_MOUNT)
    client.request("POST", f"auth/{LIFECYCLE_MOUNT}/config", jwt_config(public_keys, issuer, algorithms))
    client.request("PUT", f"sys/policies/acl/{LIFECYCLE_POLICY}", {
        "policy": f'path "sys/namespaces/team-{{{{identity.entity.aliases.{accessor}.name}}}}" '
                  '{ capabilities = ["read", "delete"] }',
    })
    if not provisioner_public_key:
        return False
    if not provisioner_issuer:
        raise ValueError("a provisioner public key needs its issuer")
    ensure_jwt_mount(client, PROVISIONER_MOUNT)
    client.request("POST", f"auth/{PROVISIONER_MOUNT}/config", jwt_config([provisioner_public_key], provisioner_issuer, ["ES256"]))
    client.request("PUT", f"sys/policies/acl/{PROVISIONER_POLICY}", {
        "policy": render_provisioner_policy(issuer, public_keys, algorithms),
    })
    client.request("POST", f"auth/{PROVISIONER_MOUNT}/role/{PROVISIONER_ROLE}", provisioner_role())
    return True
