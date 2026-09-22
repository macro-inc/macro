"""Bounded, versioned dispatch metadata for Macro's native voice runtime."""

from dataclasses import dataclass
from datetime import datetime, timezone
import json
from uuid import UUID

VOICES = frozenset(("marin", "cedar", "alloy", "coral", "sage", "verse"))
VOICE_TOPIC = "macro.voice.event"
MAX_PAYLOAD_BYTES = 15_000


def object_payload(raw: str | bytes) -> dict:
    if len(raw.encode() if isinstance(raw, str) else raw) > MAX_PAYLOAD_BYTES:
        raise ValueError("voice payload exceeds limit")
    obj = json.loads(raw)
    if not isinstance(obj, dict):
        raise ValueError("voice payload must be an object")
    return obj


def version_one(value: object) -> bool:
    return type(value) is int and value == 1


def identifier(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("identifier must be a UUID")
    return str(UUID(value))


def bounded_text(value: object, limit: int) -> str:
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise ValueError("invalid voice text")
    return value.strip()


@dataclass(frozen=True)
class VoiceJob:
    session_id: str
    voice_session_id: str
    participant_identity: str
    agent_identity: str
    voice: str
    expires_at: datetime
    runtime_url: str

    @classmethod
    def parse(cls, raw: str, *, now: datetime | None = None) -> "VoiceJob":
        obj = object_payload(raw)
        if not version_one(obj.get("schemaVersion")) or obj.get("voice") not in VOICES:
            raise ValueError("unsupported voice job")
        expires = datetime.fromisoformat(str(obj.get("expiresAt", "")).replace("Z", "+00:00"))
        now = now or datetime.now(timezone.utc)
        if expires.tzinfo is None or not 0 < (expires - now).total_seconds() <= 1_830:
            raise ValueError("expired or unbounded voice job")
        participant = bounded_text(obj.get("participantIdentity"), 200)
        agent = bounded_text(obj.get("agentIdentity"), 200)
        if participant == agent:
            raise ValueError("agent and caller identities must differ")
        return cls(
            identifier(obj.get("sessionId")),
            identifier(obj.get("voiceSessionId")),
            participant,
            agent,
            obj["voice"],
            expires,
            bounded_text(obj.get("runtimeUrl"), 2_000),
        )
