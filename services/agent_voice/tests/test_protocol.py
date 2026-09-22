import json
import unittest
from datetime import datetime, timedelta, timezone
from uuid import uuid4

from protocol import VoiceJob


def job_data():
    return {
        "schemaVersion": 1,
        "sessionId": str(uuid4()),
        "voiceSessionId": str(uuid4()),
        "participantIdentity": "voice-user-1",
        "agentIdentity": "voice-agent-1",
        "voice": "marin",
        "runtimeUrl": "https://macro.invalid/agent-sessions/session/voice/voice/runtime",
        "expiresAt": (datetime.now(timezone.utc) + timedelta(minutes=29)).isoformat(),
    }


class ProtocolTests(unittest.TestCase):
    def test_expired_unbounded_and_unknown_voice_jobs_fail_closed(self):
        for change in [
            {"expiresAt": (datetime.now(timezone.utc) - timedelta(seconds=1)).isoformat()},
            {"expiresAt": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat()},
            {"expiresAt": "2026-09-22T12:00:00"},
            {"voice": "unknown"},
            {"agentIdentity": "voice-user-1"},
            {"schemaVersion": 2},
            {"schemaVersion": True},
            {"runtimeUrl": ""},
        ]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                VoiceJob.parse(json.dumps(job_data() | change))

    def test_runtime_attachment_is_required_in_dispatch(self):
        data = job_data()
        del data["runtimeUrl"]
        with self.assertRaises(ValueError):
            VoiceJob.parse(json.dumps(data))


if __name__ == "__main__":
    unittest.main()
