import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from bridge_runtime import _profile_home


class ProfileHomeTests(unittest.TestCase):
    def test_named_missing_profile_does_not_fall_back_to_default(self):
        with tempfile.TemporaryDirectory() as root:
            with patch.dict(os.environ, {"HERMES_AGENT_BRIDGE_BASE_HOME": root}, clear=False):
                resolved_root = Path(root).resolve()
                self.assertEqual(_profile_home("missing"), resolved_root / "profiles" / "missing")
                self.assertEqual(_profile_home("default"), resolved_root)


if __name__ == "__main__":
    unittest.main()
