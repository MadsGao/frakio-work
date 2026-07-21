from __future__ import annotations

import sys
import types
import unittest

from bridge_pool import _temporary_run_overrides


class _Agent:
    def __init__(self) -> None:
        self.reasoning_config = {"effort": "default"}
        self.service_tier = "auto"
        self.request_overrides = {"existing": True, "speed": "old"}


class RunOverrideTests(unittest.TestCase):
    def setUp(self) -> None:
        self.original_constants = sys.modules.get("hermes_constants")
        constants = types.ModuleType("hermes_constants")
        constants.parse_reasoning_effort = lambda effort: {"effort": effort}
        sys.modules["hermes_constants"] = constants

    def tearDown(self) -> None:
        if self.original_constants is None:
            sys.modules.pop("hermes_constants", None)
        else:
            sys.modules["hermes_constants"] = self.original_constants

    def test_openai_overrides_are_temporary(self) -> None:
        agent = _Agent()
        with _temporary_run_overrides(agent, "high", "fast", "openai_priority"):
            self.assertEqual(agent.reasoning_config, {"effort": "high"})
            self.assertEqual(agent.service_tier, "priority")
            self.assertEqual(agent.request_overrides, {"existing": True, "service_tier": "priority"})
        self.assertEqual(agent.reasoning_config, {"effort": "default"})
        self.assertEqual(agent.service_tier, "auto")
        self.assertEqual(agent.request_overrides, {"existing": True, "speed": "old"})

    def test_anthropic_overrides_restore_after_failure(self) -> None:
        agent = _Agent()
        with self.assertRaisesRegex(RuntimeError, "failed"):
            with _temporary_run_overrides(agent, "max", "fast", "anthropic_fast"):
                self.assertEqual(agent.request_overrides, {"existing": True, "speed": "fast"})
                raise RuntimeError("failed")
        self.assertEqual(agent.reasoning_config, {"effort": "default"})
        self.assertEqual(agent.service_tier, "auto")
        self.assertEqual(agent.request_overrides, {"existing": True, "speed": "old"})

    def test_validated_runtime_overrides_are_temporary_and_protected(self) -> None:
        agent = _Agent()
        with _temporary_run_overrides(agent, runtime_overrides={
            "reasoning_config": {"effort": "ultra"},
            "service_tier": "priority",
            "request_overrides": {"temperature": 0.2, "authorization": "blocked", "stream": False},
        }):
            self.assertEqual(agent.reasoning_config, {"effort": "ultra"})
            self.assertEqual(agent.service_tier, "priority")
            self.assertEqual(agent.request_overrides, {"existing": True, "speed": "old", "service_tier": "priority", "temperature": 0.2})
        self.assertEqual(agent.reasoning_config, {"effort": "default"})
        self.assertEqual(agent.service_tier, "auto")
        self.assertEqual(agent.request_overrides, {"existing": True, "speed": "old"})


if __name__ == "__main__":
    unittest.main()
