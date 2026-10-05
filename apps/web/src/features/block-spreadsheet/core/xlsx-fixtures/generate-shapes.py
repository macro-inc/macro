"""Generate shapes.xlsx: shapes, a text box linked to a cell, a group, SmartArt
and an EMF logo, as Excel writes them.

openpyxl writes the cells and the drawing's plumbing; the drawing part, the
EMF and the SmartArt parts are written here, since openpyxl drops shapes.

Run from this directory: python3 generate-shapes.py (needs openpyxl and Pillow).
"""

import io
import struct
import zipfile

import openpyxl
from openpyxl.drawing.image import Image
from PIL import Image as PILImage

XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
DGM = "http://schemas.openxmlformats.org/drawingml/2006/diagram"
DSP = "http://schemas.microsoft.com/office/drawing/2008/diagram"


def emf_logo() -> bytes:
    """A 100 by 50 pixel logo: a red box, a blue circle and a word."""
    records = []

    def record(kind, payload):
        records.append(struct.pack("<II", kind, 8 + len(payload)) + payload)

    def rect(left, top, right, bottom):
        return struct.pack("<iiii", left, top, right, bottom)

    record(39, struct.pack("<IIII", 1, 0, 0x000000FF, 0))  # red brush
    record(37, struct.pack("<I", 1))
    record(38, struct.pack("<IIiiI", 2, 0, 2, 0, 0x00FF0000))  # blue pen
    record(37, struct.pack("<I", 2))
    record(43, rect(5, 5, 45, 45))
    record(39, struct.pack("<IIII", 3, 0, 0x00FF8000, 0))  # blue brush
    record(37, struct.pack("<I", 3))
    record(42, rect(55, 5, 95, 45))
    face = "Arial".encode("utf-16-le").ljust(64, b"\0")
    logfont = struct.pack("<iiiiiBBBBBBBB", -14, 0, 0, 0, 700, 0, 0, 0, 0, 0, 0, 0, 0) + face
    record(82, struct.pack("<I", 4) + logfont)
    record(37, struct.pack("<I", 4))
    record(24, struct.pack("<I", 0x00FFFFFF))  # white text
    record(22, struct.pack("<I", 6))  # centered
    text = "OK".encode("utf-16-le")
    # Bounds, graphics mode, scales, then the text record.
    emrtext = struct.pack("<iiIIIiiiiI", 25, 18, 2, 76, 0, 0, 0, 0, 0, 0)
    record(84, rect(0, 0, 0, 0) + struct.pack("<Iff", 1, 1.0, 1.0) + emrtext + text)
    record(14, struct.pack("<III", 0, 0, 20))
    body = b"".join(records)
    header_size = 108
    header = struct.pack(
        "<II4i4iIIIIHHIIIii",
        1,
        header_size,
        0, 0, 99, 49,  # bounds in device pixels
        0, 0, 2646, 1323,  # frame in hundredths of a millimeter
        0x464D4520,
        0x10000,
        header_size + len(body),
        len(records) + 1,
        5,
        0,
        0,
        0,
        0,
        1920,
        1080,
    ) + struct.pack("<ii", 508, 286) + struct.pack("<III", 0, 0, 0) + struct.pack("<ii", 508000, 286000)
    assert len(header) == header_size, len(header)
    return header + body


def anchor(start, end, content):
    (c1, r1), (c2, r2) = start, end
    return (
        f"<xdr:twoCellAnchor><xdr:from><xdr:col>{c1}</xdr:col><xdr:colOff>0</xdr:colOff>"
        f"<xdr:row>{r1}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>{c2}</xdr:col>"
        f"<xdr:colOff>0</xdr:colOff><xdr:row>{r2}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>"
        f"{content}<xdr:clientData/></xdr:twoCellAnchor>"
    )


def frame(x, y, cx, cy, extra=""):
    return f'<a:xfrm{extra}><a:off x="{x}" y="{y}"/><a:ext cx="{cx}" cy="{cy}"/></a:xfrm>'


DEFAULT_STYLE = (
    '<xdr:style><a:lnRef idx="2"><a:schemeClr val="accent1"><a:shade val="50000"/></a:schemeClr></a:lnRef>'
    '<a:fillRef idx="1"><a:schemeClr val="accent1"/></a:fillRef><a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>'
    '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></xdr:style>'
)

text_box = anchor(
    (4, 1),
    (8, 6),
    '<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="2" name="Notes"/><xdr:cNvSpPr txBox="1"/></xdr:nvSpPr>'
    f'<xdr:spPr>{frame(2438400, 190500, 2438400, 952500)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
    '<a:solidFill><a:srgbClr val="FFF2CC"/></a:solidFill><a:ln w="12700"><a:solidFill><a:srgbClr val="BF9000"/></a:solidFill></a:ln></xdr:spPr>'
    '<xdr:txBody><a:bodyPr vertOverflow="clip" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" anchor="t"/><a:lstStyle/>'
    '<a:p><a:r><a:rPr lang="en-US" sz="1400" b="1"><a:solidFill><a:srgbClr val="7F6000"/></a:solidFill></a:rPr><a:t>Quarterly notes</a:t></a:r></a:p>'
    '<a:p><a:r><a:rPr lang="en-US" sz="1100"/><a:t>Revenue grew </a:t></a:r><a:r><a:rPr lang="en-US" sz="1100" i="1"/><a:t>every</a:t></a:r>'
    '<a:r><a:rPr lang="en-US" sz="1100"/><a:t> month.</a:t></a:r><a:br><a:rPr lang="en-US" sz="1100"/></a:br>'
    '<a:r><a:rPr lang="en-US" sz="1100" u="sng"/><a:t>See the chart.</a:t></a:r></a:p></xdr:txBody></xdr:sp>',
)

button = anchor(
    (4, 7),
    (6, 9),
    '<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="3" name="Total button"/><xdr:cNvSpPr/></xdr:nvSpPr>'
    f'<xdr:spPr>{frame(2438400, 1333500, 1219200, 381000)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></xdr:spPr>'
    f'{DEFAULT_STYLE}<xdr:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/>'
    '<a:r><a:rPr lang="en-US" sz="1100"/><a:t>Total</a:t></a:r></a:p></xdr:txBody></xdr:sp>',
)

linked = anchor(
    (6, 7),
    (8, 9),
    '<xdr:sp macro="" textlink="$B$5"><xdr:nvSpPr><xdr:cNvPr id="4" name="Total value"/><xdr:cNvSpPr/></xdr:nvSpPr>'
    f'<xdr:spPr>{frame(3657600, 1333500, 1219200, 381000)}<a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>'
    '<a:solidFill><a:srgbClr val="E2EFDA"/></a:solidFill><a:ln w="9525"><a:solidFill><a:srgbClr val="548235"/></a:solidFill></a:ln></xdr:spPr>'
    '<xdr:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:fld id="{00000000-0000-0000-0000-000000000001}" type="TxLink">'
    '<a:rPr lang="en-US" sz="1200" b="1"><a:solidFill><a:srgbClr val="375623"/></a:solidFill></a:rPr><a:t>4,200</a:t></a:fld></a:p></xdr:txBody></xdr:sp>',
)

arrow = anchor(
    (2, 6),
    (4, 8),
    '<xdr:cxnSp macro=""><xdr:nvCxnSpPr><xdr:cNvPr id="5" name="Pointer"/><xdr:cNvCxnSpPr/></xdr:nvCxnSpPr>'
    "<xdr:spPr>"
    + frame(1219200, 1143000, 1219200, 381000, ' flipV="1"')
    + '<a:prstGeom prst="straightConnector1"><a:avLst/></a:prstGeom>'
    '<a:ln w="19050"><a:solidFill><a:srgbClr val="C00000"/></a:solidFill><a:tailEnd type="triangle"/></a:ln></xdr:spPr></xdr:cxnSp>',
)

group = anchor(
    (0, 10),
    (4, 15),
    '<xdr:grpSp><xdr:nvGrpSpPr><xdr:cNvPr id="6" name="Flow"/><xdr:cNvGrpSpPr/></xdr:nvGrpSpPr>'
    '<xdr:grpSpPr><a:xfrm><a:off x="0" y="1905000"/><a:ext cx="2438400" cy="952500"/>'
    '<a:chOff x="0" y="0"/><a:chExt cx="4876800" cy="1905000"/></a:xfrm></xdr:grpSpPr>'
    '<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="7" name="Step 1"/><xdr:cNvSpPr/></xdr:nvSpPr>'
    f'<xdr:spPr>{frame(0, 0, 1828800, 1905000)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
    '<a:solidFill><a:schemeClr val="accent2"/></a:solidFill></xdr:spPr>'
    '<xdr:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1000"/><a:t>Order</a:t></a:r></a:p></xdr:txBody></xdr:sp>'
    '<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="8" name="Step 2"/><xdr:cNvSpPr/></xdr:nvSpPr>'
    f'<xdr:spPr>{frame(3048000, 0, 1828800, 1905000)}<a:prstGeom prst="chevron"><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst></a:prstGeom>'
    '<a:solidFill><a:schemeClr val="accent6"/></a:solidFill></xdr:spPr>'
    '<xdr:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1000"/><a:t>Ship</a:t></a:r></a:p></xdr:txBody></xdr:sp>'
    '</xdr:grpSp>',
)

picture = anchor(
    (0, 16),
    (2, 19),
    '<xdr:pic><xdr:nvPicPr><xdr:cNvPr id="9" name="Logo" descr="Company logo"/><xdr:cNvPicPr/></xdr:nvPicPr>'
    '<xdr:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>'
    f'<xdr:spPr>{frame(0, 3048000, 952500, 476250)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>',
)

smartart = anchor(
    (4, 16),
    (10, 22),
    '<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="10" name="Process"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>'
    '<xdr:xfrm><a:off x="2438400" y="3048000"/><a:ext cx="3657600" cy="1143000"/></xdr:xfrm>'
    f'<a:graphic><a:graphicData uri="{DGM}"><dgm:relIds xmlns:dgm="{DGM}" r:dm="rId3" r:lo="rId4" r:qs="rId5" r:cs="rId6"/>'
    "</a:graphicData></a:graphic></xdr:graphicFrame>",
)

drawing = (
    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="{XDR}" xmlns:a="{A}" xmlns:r="{R}">'
    + text_box
    + button
    + linked
    + arrow
    + group
    + picture
    + smartart
    + "</xdr:wsDr>"
)


def relationship(rid, kind, target, microsoft=False):
    base = (
        "http://schemas.microsoft.com/office/2007/relationships"
        if microsoft
        else "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    )
    return f'<Relationship Id="{rid}" Type="{base}/{kind}" Target="{target}"/>'


drawing_rels = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + relationship("rId2", "image", "../media/logo.emf")
    + relationship("rId3", "diagramData", "../diagrams/data1.xml")
    + relationship("rId4", "diagramLayout", "../diagrams/layout1.xml")
    + relationship("rId5", "diagramQuickStyle", "../diagrams/quickStyle1.xml")
    + relationship("rId6", "diagramColors", "../diagrams/colors1.xml")
    + relationship("rId7", "diagramDrawing", "../diagrams/drawing1.xml", microsoft=True)
    + "</Relationships>"
)

data_part = (
    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:dataModel xmlns:dgm="{DGM}" xmlns:a="{A}">'
    '<dgm:ptLst><dgm:pt modelId="{1}" type="doc"><dgm:prSet/><dgm:spPr/><dgm:t><a:bodyPr/><a:p><a:endParaRPr/></a:p></dgm:t></dgm:pt></dgm:ptLst><dgm:cxnLst/><dgm:bg/><dgm:whole/>'
    f'<dgm:extLst><a:ext uri="http://schemas.microsoft.com/office/drawing/2008/diagram"><dsp:dataModelExt xmlns:dsp="{DSP}" relId="rId7" minVer="http://schemas.openxmlformats.org/drawingml/2006/diagram"/></a:ext></dgm:extLst>'
    "</dgm:dataModel>"
)


def diagram_shape(index, x, label):
    return (
        f'<dsp:sp modelId="{{{index}}}"><dsp:nvSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvSpPr/></dsp:nvSpPr>'
        f'<dsp:spPr>{frame(x, 228600, 1066800, 685800)}<a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom>'
        '<a:solidFill><a:schemeClr val="accent1"/></a:solidFill><a:ln w="12700"><a:solidFill><a:schemeClr val="lt1"/></a:solidFill></a:ln></dsp:spPr>'
        '<dsp:style><a:lnRef idx="2"><a:scrgbClr r="0" g="0" b="0"/></a:lnRef><a:fillRef idx="1"><a:scrgbClr r="0" g="0" b="0"/></a:fillRef>'
        '<a:effectRef idx="0"><a:scrgbClr r="0" g="0" b="0"/></a:effectRef><a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></dsp:style>'
        f'<dsp:txBody><a:bodyPr anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="en-US" sz="1300"/><a:t>{label}</a:t></a:r></a:p></dsp:txBody>'
        f'<dsp:txXfrm><a:off x="{x + 33480}" y="262080"/><a:ext cx="999840" cy="618840"/></dsp:txXfrm></dsp:sp>'
    )


diagram_drawing = (
    f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dsp:drawing xmlns:dgm="{DGM}" xmlns:dsp="{DSP}" xmlns:a="{A}">'
    '<dsp:spTree><dsp:nvGrpSpPr><dsp:cNvPr id="0" name=""/><dsp:cNvGrpSpPr/></dsp:nvGrpSpPr><dsp:grpSpPr/>'
    + diagram_shape(2, 0, "Plan")
    + diagram_shape(3, 1295400, "Build")
    + diagram_shape(4, 2590800, "Launch")
    + "</dsp:spTree></dsp:drawing>"
)

workbook = openpyxl.Workbook()
sheet = workbook.active
sheet.title = "Shapes"
sheet.append(("Month", "Revenue"))
for month, revenue in [("Jan", 1200), ("Feb", 1400), ("Mar", 1600)]:
    sheet.append((month, revenue))
sheet["A5"] = "Total"
sheet["B5"] = "=SUM(B2:B4)"
# A placeholder picture makes openpyxl write the drawing's plumbing.
placeholder = io.BytesIO()
PILImage.new("RGB", (4, 4), (255, 255, 255)).save(placeholder, format="PNG")
placeholder.seek(0)
sheet.add_image(Image(placeholder), "A20")
buffer = io.BytesIO()
workbook.save(buffer)

source = zipfile.ZipFile(io.BytesIO(buffer.getvalue()))
with zipfile.ZipFile("shapes.xlsx", "w", zipfile.ZIP_DEFLATED) as target:
    for item in source.infolist():
        data = source.read(item.filename)
        if item.filename == "xl/drawings/drawing1.xml":
            data = drawing.encode()
        elif item.filename == "xl/drawings/_rels/drawing1.xml.rels":
            data = drawing_rels.encode()
        elif item.filename == "[Content_Types].xml":
            overrides = "".join(
                f'<Override PartName="/xl/diagrams/{name}" ContentType="application/vnd.openxmlformats-officedocument.{kind}"/>'
                for name, kind in [
                    ("data1.xml", "drawingml.diagramData+xml"),
                    ("layout1.xml", "drawingml.diagramLayout+xml"),
                    ("quickStyle1.xml", "drawingml.diagramStyle+xml"),
                    ("colors1.xml", "drawingml.diagramColors+xml"),
                ]
            ) + '<Override PartName="/xl/diagrams/drawing1.xml" ContentType="application/vnd.ms-office.drawingml.diagramDrawing+xml"/>'
            data = (
                data.decode()
                .replace("</Types>", f'<Default Extension="emf" ContentType="image/x-emf"/>{overrides}</Types>')
                .encode()
            )
        elif item.filename.startswith("xl/media/"):
            continue
        target.writestr(item, data)
    target.writestr("xl/media/logo.emf", emf_logo())
    target.writestr("xl/diagrams/data1.xml", data_part)
    for name, root in [
        ("layout1.xml", "layoutDef"),
        ("quickStyle1.xml", "styleDef"),
        ("colors1.xml", "colorsDef"),
    ]:
        target.writestr(
            f"xl/diagrams/{name}",
            f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<dgm:{root} xmlns:dgm="{DGM}" uniqueId="urn:example"/>',
        )
    target.writestr("xl/diagrams/drawing1.xml", diagram_drawing)
