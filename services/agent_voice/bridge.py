"""Delegate to the browser's existing authenticated agent-session controls."""

import asyncio
from collections.abc import Awaitable, Callable

from protocol import TaskLedger, VoiceJob, encode_payload, identifier, object_payload, task_prompt

Rpc = Callable[[str, str], Awaitable[str]]


class MacroBridge:
    def __init__(self, job: VoiceJob, rpc: Rpc) -> None:
        self.job = job
        self.rpc = rpc
        self.ledger = TaskLedger()
        self._requests: dict[str, asyncio.Task[dict]] = {}
        self._cancellations: dict[str, asyncio.Task[dict]] = {}
        self._request_prompts: dict[str, str] = {}
        self._cancellation_payloads: dict[str, tuple[str, str | None]] = {}

    async def request(self, call_id: str, prompt: str, dialogue: list[dict[str, str]]) -> dict:
        request_id = self.job.request_id(call_id)
        if request_id in self._request_prompts and self._request_prompts[request_id] != prompt:
            return {"taskId": request_id, "status": "conflict", "message": "That tool call already named a different request."}
        if request_id not in self._requests:
            self.ledger.register(request_id)
            self._request_prompts[request_id] = prompt
            self._requests[request_id] = asyncio.create_task(self._request(request_id, prompt, dialogue))
        # Barge-in cancels spoken output, not an already-dispatched task. The
        # ledger keeps receiving that task's events even if this tool is interrupted.
        return await asyncio.shield(self._requests[request_id])

    async def _request(self, request_id: str, prompt: str, dialogue: list[dict[str, str]]) -> dict:
        try:
            payload = encode_payload({"version": 1, "requestId": request_id, "prompt": task_prompt(prompt, dialogue)})
        except ValueError:
            return {"taskId": request_id, "status": "failed", "message": "The request is too long. Ask the user to shorten it; no work was submitted."}
        try:
            response = object_payload(await self.rpc("macro.agent.request", payload))
            if identifier(response.get("taskId")) != request_id:
                raise ValueError("task identity mismatch")
            if response.get("status") not in ("accepted", "queued", "running", "failed", "conflict"):
                raise ValueError("invalid task disposition")
            return response
        except Exception:
            # Never retry an ambiguous submission with a new action ID. The
            # canonical agent transcript can establish whether it was accepted.
            return {
                "taskId": request_id,
                "status": "unknown",
                "message": "Delivery could not be confirmed. Check the agent transcript; do not submit it again automatically.",
            }

    async def cancel(self, call_id: str, task_id: str, replacement: str | None) -> dict:
        task_id = identifier(task_id)
        if task_id not in self.ledger.tasks:
            return {"status": "conflict", "message": "This voice session does not own that task."}
        request_id = self.job.request_id(call_id)
        payload = (task_id, replacement)
        if request_id in self._cancellation_payloads and self._cancellation_payloads[request_id] != payload:
            return {"status": "conflict", "message": "That tool call already named a different cancellation."}
        if request_id not in self._cancellations:
            if len(self._cancellations) >= 128:
                return {"status": "failed", "message": "Voice control limit reached. Use the on-screen task controls."}
            self._cancellation_payloads[request_id] = payload
            self._cancellations[request_id] = asyncio.create_task(self._cancel(request_id, task_id, replacement))
        return await asyncio.shield(self._cancellations[request_id])

    async def _cancel(self, request_id: str, task_id: str, replacement: str | None) -> dict:
        payload = {"version": 1, "requestId": request_id, "taskId": task_id}
        try:
            if replacement:
                payload["replacementPrompt"] = task_prompt(replacement, [])
                # Register before the RPC to handle events that race its reply.
                self.ledger.register(request_id)
            raw = encode_payload(payload)
        except ValueError:
            return {"status": "failed", "message": "The replacement could not be submitted. No cancellation was sent; use the on-screen task controls."}
        try:
            response = object_payload(await self.rpc("macro.agent.cancel", raw))
            if response.get("status") not in ("stopping", "replaced", "already_completed", "conflict", "failed"):
                raise ValueError("invalid cancellation disposition")
            if response["status"] == "replaced" and (
                not replacement or identifier(response.get("replacementTaskId")) != request_id
            ):
                raise ValueError("replacement identity mismatch")
            if response["status"] in ("stopping", "replaced"):
                self.ledger.supersede(task_id)
            return response
        except Exception:
            return {"status": "unknown", "message": "Cancellation was not confirmed. Do not claim the task stopped."}

    async def close(self) -> None:
        # Media teardown never issues a cancellation to the durable harness.
        tasks = [*self._requests.values(), *self._cancellations.values()]
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
