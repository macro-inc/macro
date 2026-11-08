"""Minimal ACP peer: discovery succeeds, and any prompt is a test failure."""

import json
import sys

for line in sys.stdin:
    request = json.loads(line)
    if request["method"] == "initialize":
        result = {"protocolVersion": 1, "agentCapabilities": {}}
    elif request["method"] == "session/new":
        result = {
            "sessionId": "probe",
            "configOptions": [{
                "id": "model",
                "name": "Model",
                "type": "select",
                "currentValue": "test-model",
                "options": [{"value": "test-model", "name": "Test model"}],
            }],
        }
    else:
        raise AssertionError(f"unexpected method: {request['method']}")
    print(json.dumps({"jsonrpc": "2.0", "id": request["id"], "result": result}), flush=True)
