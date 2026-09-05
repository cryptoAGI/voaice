# SPDX-License-Identifier: Apache-2.0
"""audbol — modular scientific and forensic audio analysis, measured exactly.

Pronounced "oddball".

    from audbol import read, measure, chart, report

Every measured quantity is a Fixed18: an exact integer count of 1e-18 units,
carrying its own unit. See audbol/fixed.py for why, and for what that does and
does not claim.
"""
from .fixed import Fixed18, SCALE            # noqa: F401
from .read import Clip, read                 # noqa: F401
from . import measure, chart, report         # noqa: F401

__version__ = "0.1.0"
__all__ = ["Fixed18", "SCALE", "Clip", "read", "measure", "chart", "report", "__version__"]
