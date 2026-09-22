import asyncio
import json
import unittest

from bridge import MacroBridge
from protocol import VoiceJob
from test_protocol import job_data


class BridgeTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.job = VoiceJob.parse(json.dumps(job_data()))
        self.calls = []

    async def test_interrupted_tool_wait_does_not_cancel_dispatched_work(self):
        started = asyncio.Event()
        release = asyncio.Event()

        async def rpc(method, payload):
            self.calls.append((method, json.loads(payload)))
            started.set()
            await release.wait()
            return json.dumps({"taskId": self.calls[-1][1]["requestId"], "status": "accepted"})

        bridge = MacroBridge(self.job, rpc)
        request = asyncio.create_task(bridge.request("call-1", "Find the notes", []))
        await started.wait()
        request.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await request
        release.set()
        result = await bridge.request("call-1", "Find the notes", [])
        self.assertEqual(len(self.calls), 1)
        self.assertEqual(result["status"], "accepted")
        await bridge.close()

    async def test_ambiguous_delivery_is_not_retried(self):
        async def rpc(method, payload):
            self.calls.append(method)
            raise TimeoutError()

        bridge = MacroBridge(self.job, rpc)
        first = await bridge.request("call-1", "Create a draft", [])
        second = await bridge.request("call-1", "Create a draft", [])
        self.assertEqual(first, second)
        self.assertEqual(first["status"], "unknown")
        self.assertEqual(self.calls, ["macro.agent.request"])
        await bridge.close()

    async def test_cancel_cannot_target_an_unowned_task(self):
        async def rpc(method, payload):
            self.fail("Unowned task must not reach the browser")

        bridge = MacroBridge(self.job, rpc)
        result = await bridge.cancel("cancel-1", self.job.request_id("other"), None)
        self.assertEqual(result["status"], "conflict")

    async def test_conflict_does_not_suppress_the_real_task_result(self):
        async def rpc(method, payload):
            return json.dumps({"status": "conflict"})

        bridge = MacroBridge(self.job, rpc)
        task = self.job.request_id("task-1")
        bridge.ledger.register(task)
        result = await bridge.cancel("cancel-1", task, "Use the corrected date")
        self.assertEqual(result["status"], "conflict")
        self.assertFalse(bridge.ledger.tasks[task].superseded)

    async def test_replacement_registered_before_reply_and_old_result_suppressed(self):
        async def rpc(method, payload):
            obj = json.loads(payload)
            self.assertIn(obj["requestId"], bridge.ledger.tasks)
            return json.dumps({"status": "replaced", "replacementTaskId": obj["requestId"]})

        bridge = MacroBridge(self.job, rpc)
        task = self.job.request_id("task-1")
        bridge.ledger.register(task)
        result = await bridge.cancel("cancel-1", task, "Use the corrected date")
        self.assertEqual(result["status"], "replaced")
        self.assertTrue(bridge.ledger.tasks[task].superseded)

    async def test_interrupted_cancellation_is_sent_once_and_still_marks_old_work(self):
        started, release = asyncio.Event(), asyncio.Event()

        async def rpc(method, payload):
            self.calls.append(method)
            started.set()
            await release.wait()
            return json.dumps({"status": "stopping"})

        bridge = MacroBridge(self.job, rpc)
        task = self.job.request_id("task-1")
        bridge.ledger.register(task)
        request = asyncio.create_task(bridge.cancel("cancel-1", task, None))
        await started.wait()
        request.cancel()
        with self.assertRaises(asyncio.CancelledError):
            await request
        release.set()
        result = await bridge.cancel("cancel-1", task, None)
        self.assertEqual(result["status"], "stopping")
        self.assertTrue(bridge.ledger.tasks[task].superseded)
        self.assertEqual(self.calls, ["macro.agent.cancel"])
        await bridge.close()

    async def test_ambiguous_cancellation_is_not_retried(self):
        async def rpc(method, payload):
            self.calls.append(method)
            raise TimeoutError()

        bridge = MacroBridge(self.job, rpc)
        task = self.job.request_id("task-1")
        bridge.ledger.register(task)
        for _ in range(2):
            result = await bridge.cancel("cancel-1", task, None)
            self.assertEqual(result["status"], "unknown")
        self.assertFalse(bridge.ledger.tasks[task].superseded)
        self.assertEqual(self.calls, ["macro.agent.cancel"])

    async def test_replacement_identity_mismatch_is_not_confirmed(self):
        async def rpc(method, payload):
            return json.dumps({"status": "replaced", "replacementTaskId": self.job.request_id("other")})

        bridge = MacroBridge(self.job, rpc)
        task = self.job.request_id("task-1")
        bridge.ledger.register(task)
        result = await bridge.cancel("cancel-1", task, "Corrected instruction")
        self.assertEqual(result["status"], "unknown")
        self.assertFalse(bridge.ledger.tasks[task].superseded)

    async def test_unicode_request_uses_livekit_wire_byte_limit(self):
        async def rpc(method, payload):
            self.assertLessEqual(len(payload.encode()), 15_000)
            obj = json.loads(payload)
            self.assertIn("界", obj["prompt"])
            return json.dumps({"taskId": obj["requestId"], "status": "accepted"})

        bridge = MacroBridge(self.job, rpc)
        result = await bridge.request("call-1", "界" * 2_000, [{"role": "user", "text": "界" * 1_000}])
        self.assertEqual(result["status"], "accepted")

    async def test_oversize_request_is_known_not_submitted(self):
        async def rpc(method, payload):
            self.fail("Invalid prompt must not reach the browser")

        bridge = MacroBridge(self.job, rpc)
        result = await bridge.request("call-1", "界" * 6_000, [])
        self.assertEqual(result["status"], "failed")

    async def test_same_call_id_with_changed_arguments_is_a_conflict(self):
        async def rpc(method, payload):
            self.calls.append(method)
            request = json.loads(payload)
            if method == "macro.agent.request":
                return json.dumps({"taskId": request["requestId"], "status": "accepted"})
            return json.dumps({"status": "stopping"})

        bridge = MacroBridge(self.job, rpc)
        accepted = await bridge.request("call-1", "Find notes", [])
        changed = await bridge.request("call-1", "Delete notes", [])
        self.assertEqual(changed["status"], "conflict")
        await bridge.cancel("cancel-1", accepted["taskId"], None)
        changed = await bridge.cancel("cancel-1", accepted["taskId"], "Different task")
        self.assertEqual(changed["status"], "conflict")
        self.assertEqual(self.calls, ["macro.agent.request", "macro.agent.cancel"])


if __name__ == "__main__":
    unittest.main()
