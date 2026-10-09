"""Set the installer volume's Finder layout without launching Finder."""

import sys
from pathlib import Path

from ds_store import DSStore


with DSStore.open(str(Path(sys.argv[1]) / ".DS_Store"), "w+") as store:
    store["."]["vSrn"] = ("long", 1)
    store["."]["icvl"] = ("type", b"icnv")
    store["."]["bwsp"] = {
        "ShowStatusBar": False,
        "ShowTabView": False,
        "ShowToolbar": False,
        "ShowPathbar": False,
        "ShowSidebar": False,
        "WindowBounds": "{{200, 200}, {560, 320}}",
    }
    store["."]["icvp"] = {
        "viewOptionsVersion": 1,
        "backgroundType": 1,
        "backgroundColorRed": 1.0,
        "backgroundColorGreen": 1.0,
        "backgroundColorBlue": 1.0,
        "arrangeBy": "none",
        "gridOffsetX": 0.0,
        "gridOffsetY": 0.0,
        "gridSpacing": 100.0,
        "iconSize": 96.0,
        "textSize": 14.0,
        "labelOnBottom": True,
        "showIconPreview": True,
        "showItemInfo": False,
    }
    store["Macro.app"]["Iloc"] = (150, 140)
    store["Applications"]["Iloc"] = (410, 140)
