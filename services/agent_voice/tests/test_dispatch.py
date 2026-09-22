"""Worker admission uses the real HTTP client before accepting a LiveKit job."""

import asyncio
import json
from time import monotonic
from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from aiohttp import web
import jwt

from protocol import VoiceJob
from test_config import configured_environment
from test_protocol import job_data
from worker import request_job, runtime_available


class DispatchTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.status = 204
        self.delay = 0
        self.requests = []

        async def availability(request):
            self.requests.append(request)
            if self.delay:
                await asyncio.sleep(self.delay)
            if self.status == 302:
                return web.Response(status=302, headers={"Location": "/unexpected"})
            return web.Response(status=self.status)

        app = web.Application()
        app.router.add_get("/runtime/availability", availability)
        app.router.add_get("/unexpected", availability)
        self.runner = web.AppRunner(app)
        await self.runner.setup()
        site = web.TCPSite(self.runner, "127.0.0.1", 0)
        await site.start()
        port = site._server.sockets[0].getsockname()[1]
        self.metadata = job_data() | {"runtimeUrl": f"http://127.0.0.1:{port}/runtime"}
        self.environment = configured_environment() | {"LIVEKIT_API_SECRET": "offline-dispatch-contract-secret-long-enough"}
        self.env_patch = patch.dict("os.environ", self.environment, clear=True)
        self.env_patch.start()

    async def asyncTearDown(self):
        self.env_patch.stop()
        await self.runner.cleanup()

    def request(self):
        return SimpleNamespace(
            job=SimpleNamespace(metadata=json.dumps(self.metadata), room=SimpleNamespace(name="private-voice-room")),
            accept=AsyncMock(), reject=AsyncMock(),
        )

    async def test_owner_probe_uses_short_lived_room_credential_before_accept(self):
        request = self.request()
        await request_job(request)
        request.accept.assert_awaited_once()
        request.reject.assert_not_awaited()
        claims = jwt.decode(
            self.requests[0].headers["Authorization"].removeprefix("Bearer "),
            self.environment["LIVEKIT_API_SECRET"],
            issuer=self.environment["LIVEKIT_API_KEY"], algorithms=["HS256"],
        )
        self.assertEqual(claims["sub"], self.metadata["agentIdentity"])
        self.assertEqual(claims["video"]["room"], "private-voice-room")
        self.assertTrue(claims["video"]["roomJoin"])
        self.assertLessEqual(claims["exp"] - claims["nbf"], 120)

    async def test_foreign_stack_and_redirects_are_rejected_without_accepting(self):
        for status in (401, 403, 404, 302):
            self.status = status
            self.requests.clear()
            request = self.request()
            await request_job(request)
            request.reject.assert_awaited_once_with(terminate=False)
            request.accept.assert_not_awaited()
            self.assertEqual(len(self.requests), 1)

    async def test_probe_has_a_two_second_total_deadline(self):
        self.delay = 2.5
        started = monotonic()
        self.assertFalse(await runtime_available(VoiceJob.parse(json.dumps(self.metadata)), "private-voice-room"))
        self.assertLess(monotonic() - started, 2.4)
