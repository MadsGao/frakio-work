from __future__ import annotations

import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

import bridge_pool


class _Session:
    config = {"provider": "test-provider", "model": "test-model"}


class AttachmentRoutingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.pool = bridge_pool.AgentPool.__new__(bridge_pool.AgentPool)
        self.original_load_cfg = bridge_pool._load_cfg
        bridge_pool._load_cfg = lambda _profile=None: {}
        self.temp_dir = tempfile.TemporaryDirectory()
        self.image_path = Path(self.temp_dir.name) / "sample.png"
        self.image_path.write_bytes(b"image")
        self.text_path = Path(self.temp_dir.name) / "notes.md"
        self.text_path.write_text("# Notes", encoding="utf-8")

    def tearDown(self) -> None:
        bridge_pool._load_cfg = self.original_load_cfg
        self.temp_dir.cleanup()

    def _install_image_routing(self, mode: str) -> None:
        agent_module = sys.modules.setdefault("agent", types.ModuleType("agent"))
        routing = types.ModuleType("agent.image_routing")
        routing.decide_image_input_mode = lambda *_args: mode
        routing.build_native_content_parts = lambda text, paths: ([
            {"type": "text", "text": text},
            {"type": "image_url", "image_url": {"url": f"file://{paths[0]}"}},
        ], [])
        sys.modules["agent.image_routing"] = routing
        setattr(agent_module, "image_routing", routing)

    def test_regular_files_are_exposed_as_local_tool_paths(self) -> None:
        result = self.pool._prepare_attachment_message(_Session(), "Summarize", [{
            "name": "notes.md", "kind": "text", "mime_type": "text/markdown", "path": str(self.text_path),
        }], "default")
        self.assertIn("Summarize", result)
        self.assertIn(str(self.text_path), result)
        self.assertIn("read_file", result)

    def test_native_image_route_produces_multimodal_parts(self) -> None:
        self._install_image_routing("native")
        result = self.pool._prepare_attachment_message(_Session(), "Describe", [{
            "name": "sample.png", "kind": "image", "mime_type": "image/png", "path": str(self.image_path),
        }], "default")
        self.assertTrue(any(part.get("type") == "image_url" for part in result))

    def test_text_image_route_requires_successful_vision_analysis(self) -> None:
        self._install_image_routing("text")
        tools_module = sys.modules.setdefault("tools", types.ModuleType("tools"))
        vision = types.ModuleType("tools.vision_tools")

        async def analyze(**_kwargs):
            return json.dumps({"success": True, "analysis": "A green square"})

        vision.vision_analyze_tool = analyze
        sys.modules["tools.vision_tools"] = vision
        setattr(tools_module, "vision_tools", vision)
        result = self.pool._prepare_attachment_message(_Session(), "Describe", [{
            "name": "sample.png", "kind": "image", "mime_type": "image/png", "path": str(self.image_path),
        }], "default")
        self.assertIn("A green square", result)
        self.assertIn(str(self.image_path), result)

    def test_missing_attachment_fails_instead_of_silently_dropping(self) -> None:
        with self.assertRaisesRegex(RuntimeError, "附件文件不存在"):
            self.pool._prepare_attachment_message(_Session(), "Describe", [{
                "name": "missing.png", "kind": "image", "mime_type": "image/png", "path": str(self.image_path.with_name("missing.png")),
            }], "default")


if __name__ == "__main__":
    unittest.main()
