"""Startup configuration that never includes credential values in errors."""

from collections.abc import Mapping, Sequence
from urllib.parse import urlsplit, urlunsplit


class VoiceConfigurationError(ValueError):
    """A missing, placeholder or malformed worker setting."""


def worker_name(environment: Mapping[str, str]) -> str:
    """Match the harness's dispatch scope without introducing another setting."""
    scope = environment.get("ENVIRONMENT", "prod")
    if scope == "local":
        scope += "-" + environment.get("COMPOSE_PROJECT_NAME", "macro")
    elif scope not in {"dev", "prod"}:
        raise VoiceConfigurationError("Invalid ENVIRONMENT")
    name = "macro-agent-voice-" + scope
    if len(name) > 200 or not all(character.isascii() and (character.isalnum() or character in "-_") for character in name):
        raise VoiceConfigurationError("Invalid COMPOSE_PROJECT_NAME")
    return name


def credential_present(value: str | None) -> bool:
    if not value or not value.strip():
        return False
    normalized = value.strip().lower()
    return normalized not in {"changeme", "change-me", "placeholder", "dummy", "stub"} and not normalized.startswith(
        ("local-", "your-", "your_", "replace-", "replace_", "placeholder-", "test-key", "${")
    )


def requires_credentials(arguments: Sequence[str]) -> bool:
    """Gate commands that run workers; retain the SDK's help and asset-download CLI."""
    return bool(arguments) and arguments[0] in {"start", "dev", "connect", "console"} and not any(
        argument in {"--help", "-h"} for argument in arguments
    )


def connection_options(environment: Mapping[str, str], *, required: bool) -> dict:
    """Map shared Macro configuration to the LiveKit SDK without copying secrets."""
    raw_url = environment.get("LIVEKIT_URL") or environment.get("LIVEKIT_SERVER_URL") or ""
    api_key = environment.get("LIVEKIT_API_KEY")
    api_secret = environment.get("LIVEKIT_API_SECRET")
    url = None
    if raw_url.strip():
        try:
            parsed = urlsplit(raw_url.strip())
            if (
                parsed.scheme not in {"http", "https", "ws", "wss"}
                or not parsed.hostname
                or parsed.username is not None
                or parsed.password is not None
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError()
            # Parse the port too: urlsplit defers invalid-port errors until read.
            parsed.port
            url = urlunsplit(parsed._replace(scheme={"http": "ws", "https": "wss"}.get(parsed.scheme, parsed.scheme)))
        except ValueError:
            if required:
                raise VoiceConfigurationError("Invalid LIVEKIT_URL or LIVEKIT_SERVER_URL") from None
    if required:
        missing = [
            name
            for name, value in (
                ("OPENAI_API_KEY", environment.get("OPENAI_API_KEY")),
                ("LIVEKIT_API_KEY", api_key),
                ("LIVEKIT_API_SECRET", api_secret),
            )
            if not credential_present(value)
        ]
        if url is None:
            missing.append("LIVEKIT_URL or LIVEKIT_SERVER_URL")
        if missing:
            raise VoiceConfigurationError("Missing or placeholder voice configuration: " + ", ".join(missing))
    return {"ws_url": url, "api_key": api_key, "api_secret": api_secret}
