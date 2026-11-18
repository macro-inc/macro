"""Generate office-2016-charts.xlsx: histogram, pareto, waterfall, funnel, box
and whisker, treemap and sunburst charts as Excel 2016 writes them (`cx:`
chartEx parts behind a compatibility fallback), and pie of pie and bar of pie
charts (`c:ofPieChart`).

No spreadsheet library writes chartEx parts, so every part is written here
with the standard library, laid out as Excel lays them out.

Run from this directory: python3 generate-office-2016-charts.py
"""

import zipfile
from xml.sax.saxutils import escape

MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG = "http://schemas.openxmlformats.org/package/2006/relationships"
XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
A = "http://schemas.openxmlformats.org/drawingml/2006/main"
C = "http://schemas.openxmlformats.org/drawingml/2006/chart"
CX = "http://schemas.microsoft.com/office/drawing/2014/chartex"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
CX1 = "http://schemas.microsoft.com/office/drawing/2015/9/8/chartex"
CX2 = "http://schemas.microsoft.com/office/drawing/2015/10/21/chartex"
CHARTEX_REL = "http://schemas.microsoft.com/office/2014/relationships/chartEx"

# Each sheet: its rows, then its charts, each anchored over columns E to L.
SHEETS = [
    {
        "name": "Scores",
        "rows": [["Score"]] + [[value] for value in [52, 58, 61, 63, 67, 68, 71, 72, 74, 75, 79, 83, 86, 91, 98]],
        "charts": [
            {
                "kind": "histogram",
                "title": "Scores",
                "data": [("numDim", "val", "Scores!$A$2:$A$16", 0)],
                "name": "Scores!$A$1",
                "layout": '<cx:binning intervalClosed="r"><cx:binSize val="10"/></cx:binning>',
                "axes": "category",
            }
        ],
    },
    {
        "name": "Defects",
        "rows": [["Cause", "Count"], ["Scratches", 40], ["Dents", 10], ["Chips", 30], ["Cracks", 20], ["Stains", 5]],
        "charts": [
            {
                "kind": "pareto",
                "title": "Defects",
                "data": [
                    ("strDim", "cat", "Defects!$A$2:$A$6", 0),
                    ("numDim", "val", "Defects!$B$2:$B$6", 1),
                ],
                "name": "Defects!$B$1",
                "layout": "<cx:aggregation/>",
                "axes": "pareto",
            }
        ],
    },
    {
        "name": "Cash",
        "rows": [
            ["Step", "Amount"],
            ["Start", 100],
            ["Sales", 60],
            ["Services", 20],
            ["Costs", -50],
            ["Tax", -15],
            ["End", 115],
        ],
        "charts": [
            {
                "kind": "waterfall",
                "title": "Cash flow",
                "data": [
                    ("strDim", "cat", "Cash!$A$2:$A$7", 0),
                    ("numDim", "val", "Cash!$B$2:$B$7", 1),
                ],
                "name": "Cash!$B$1",
                "labels": True,
                "layout": '<cx:visibility connectorLines="1"/><cx:subtotals><cx:idx val="5"/></cx:subtotals>',
                "axes": "category",
                "legend": "t",
            }
        ],
    },
    {
        "name": "Pipeline",
        "rows": [["Stage", "People"], ["Visits", 1000], ["Leads", 400], ["Trials", 150], ["Sales", 60]],
        "charts": [
            {
                "kind": "funnel",
                "title": "Pipeline",
                "data": [
                    ("strDim", "cat", "Pipeline!$A$2:$A$5", 0),
                    ("numDim", "val", "Pipeline!$B$2:$B$5", 1),
                ],
                "name": "Pipeline!$B$1",
                "labels": True,
                "layout": "",
                "axes": "funnel",
            }
        ],
    },
    {
        "name": "Times",
        "rows": [["Region", "Minutes"]]
        + [["East", value] for value in [12, 14, 15, 15, 16, 18, 19, 41]]
        + [["West", value] for value in [20, 22, 23, 25, 26, 30]],
        "charts": [
            {
                "kind": "boxWhisker",
                "title": "Delivery times",
                "data": [
                    ("strDim", "cat", "Times!$A$2:$A$15", 0),
                    ("numDim", "val", "Times!$B$2:$B$15", 1),
                ],
                "name": "Times!$B$1",
                "layout": '<cx:visibility meanLine="0" meanMarker="1" nonoutliers="0" outliers="1"/><cx:statistics quartileMethod="exclusive"/>',
                "axes": "category",
            }
        ],
    },
    {
        "name": "Stores",
        "rows": [
            ["Region", "Store", "Sales"],
            ["North", "Downtown", 30],
            [None, "Airport", 20],
            ["South", "Harbor", 25],
            [None, "Mall", 15],
            ["West", None, 10],
        ],
        "charts": [
            {
                "kind": "treemap",
                "title": "Store sales",
                "data": [
                    ("strDim", "cat", "Stores!$A$2:$B$6", 0, 2),
                    ("numDim", "size", "Stores!$C$2:$C$6", 2),
                ],
                "name": "Stores!$C$1",
                "layout": '<cx:parentLabelLayout val="banner"/>',
                "axes": None,
                "legend": "r",
            },
            {
                "kind": "sunburst",
                "title": "Store sales by region",
                "data": [
                    ("strDim", "cat", "Stores!$A$2:$B$6", 0, 2),
                    ("numDim", "size", "Stores!$C$2:$C$6", 2),
                ],
                "name": "Stores!$C$1",
                "layout": "",
                "axes": None,
            },
        ],
    },
    {
        "name": "Share",
        "rows": [
            ["Product", "Share"],
            ["Desktop", 40],
            ["Phone", 30],
            ["Tablet", 12],
            ["Watch", 8],
            ["TV", 6],
            ["Other", 4],
        ],
        "charts": [
            {"kind": "ofPie", "type": "pie", "split": ("pos", 3), "title": "Pie of pie"},
            {"kind": "ofPie", "type": "bar", "split": ("val", 10), "title": "Bar of pie"},
        ],
    },
]


def column_name(index):
    name = ""
    index += 1
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def cell_values(rows, column, first, last):
    return [rows[row][column] if column < len(rows[row]) else None for row in range(first, last + 1)]


def lvl(values, numeric):
    points = "".join(
        f'<cx:pt idx="{index}">{escape(str(value))}</cx:pt>'
        for index, value in enumerate(values)
        if value is not None
    )
    format_code = ' formatCode="General"' if numeric else ""
    return f'<cx:lvl ptCount="{len(values)}"{format_code}>{points}</cx:lvl>'


def dimension(sheet, element, kind, reference, column, width=1):
    """A data dimension and its cached values; labels in `width` columns are a
    level each, innermost first."""
    rows = sheet["rows"]
    count = len(rows) - 1
    if element == "numDim":
        cache = lvl(cell_values(rows, column, 1, count), True)
    else:
        cache = "".join(
            lvl(cell_values(rows, level, 1, count), False)
            for level in reversed(range(column, column + width))
        )
    return f"<cx:{element} type=\"{kind}\"><cx:f>{reference}</cx:f>{cache}</cx:{element}>"


def chartex_part(sheet, chart):
    data = "".join(dimension(sheet, *entry) for entry in chart["data"])
    name_text = sheet["rows"][0][chart["data"][-1][3]]
    labels = (
        '<cx:dataLabels pos="outEnd"><cx:visibility seriesName="0" categoryName="0" value="1"/></cx:dataLabels>'
        if chart.get("labels")
        else ""
    )
    layout = f"<cx:layoutPr>{chart['layout']}</cx:layoutPr>" if chart["layout"] else ""
    axis_id = '<cx:axisId val="1"/>' if chart["kind"] == "pareto" else ""
    series = (
        f'<cx:series layoutId="{"clusteredColumn" if chart["kind"] in ("histogram", "pareto") else chart["kind"]}" uniqueId="{{6C4B4D2E-0000-4000-8000-000000000001}}">'
        f'<cx:tx><cx:txData><cx:f>{chart["name"]}</cx:f><cx:v>{escape(name_text)}</cx:v></cx:txData></cx:tx>'
        f"{labels}<cx:dataId val=\"0\"/>{layout}{axis_id}</cx:series>"
    )
    if chart["kind"] == "pareto":
        series += '<cx:series layoutId="paretoLine" ownerIdx="0" uniqueId="{6C4B4D2E-0000-4000-8000-000000000002}"><cx:axisId val="2"/></cx:series>'
    axes = {
        "category": '<cx:axis id="0"><cx:catScaling gapWidth="0.5"/><cx:tickLabels/></cx:axis><cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis>',
        "pareto": '<cx:axis id="0"><cx:catScaling gapWidth="0"/><cx:tickLabels/></cx:axis><cx:axis id="1"><cx:valScaling/><cx:majorGridlines/><cx:tickLabels/></cx:axis><cx:axis id="2"><cx:valScaling max="1" min="0"/><cx:units unit="percentage"/><cx:tickLabels/></cx:axis>',
        "funnel": '<cx:axis id="0"><cx:catScaling gapWidth="0.06"/><cx:tickLabels/></cx:axis>',
        None: "",
    }[chart["axes"]]
    if chart["kind"] == "histogram":
        axes = axes.replace('gapWidth="0.5"', 'gapWidth="0"')
    legend = f'<cx:legend pos="{chart["legend"]}" align="ctr" overlay="0"/>' if chart.get("legend") else ""
    title = (
        '<cx:title pos="t" align="ctr" overlay="0"><cx:tx><cx:txData><cx:v>'
        f'{escape(chart["title"])}</cx:v></cx:txData></cx:tx></cx:title>'
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<cx:chartSpace xmlns:a="{A}" xmlns:r="{REL}" xmlns:cx="{CX}">'
        f'<cx:chartData><cx:data id="0">{data}</cx:data></cx:chartData>'
        f"<cx:chart>{title}<cx:plotArea><cx:plotAreaRegion>{series}</cx:plotAreaRegion>{axes}</cx:plotArea>{legend}</cx:chart>"
        "</cx:chartSpace>"
    )


def of_pie_part(sheet, chart):
    rows = sheet["rows"]
    count = len(rows) - 1
    labels = "".join(
        f'<c:pt idx="{index}"><c:v>{escape(row[0])}</c:v></c:pt>' for index, row in enumerate(rows[1:])
    )
    values = "".join(f'<c:pt idx="{index}"><c:v>{row[1]}</c:v></c:pt>' for index, row in enumerate(rows[1:]))
    split, position = chart["split"]
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<c:chartSpace xmlns:c="{C}" xmlns:a="{A}" xmlns:r="{REL}"><c:roundedCorners val="0"/><c:chart>'
        f'<c:title><c:tx><c:rich><a:bodyPr/><a:p><a:r><a:t>{chart["title"]}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>'
        '<c:autoTitleDeleted val="0"/><c:plotArea><c:layout/><c:ofPieChart>'
        f'<c:ofPieType val="{chart["type"]}"/><c:varyColors val="1"/>'
        '<c:ser><c:idx val="0"/><c:order val="0"/>'
        f'<c:tx><c:strRef><c:f>Share!$B$1</c:f><c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Share</c:v></c:pt></c:strCache></c:strRef></c:tx>'
        f'<c:cat><c:strRef><c:f>Share!$A$2:$A${count + 1}</c:f><c:strCache><c:ptCount val="{count}"/>{labels}</c:strCache></c:strRef></c:cat>'
        f'<c:val><c:numRef><c:f>Share!$B$2:$B${count + 1}</c:f><c:numCache><c:formatCode>General</c:formatCode><c:ptCount val="{count}"/>{values}</c:numCache></c:numRef></c:val>'
        "</c:ser>"
        f'<c:gapWidth val="100"/><c:splitType val="{split}"/><c:splitPos val="{position}"/><c:secondPieSize val="75"/>'
        "<c:serLines/></c:ofPieChart></c:plotArea>"
        '<c:legend><c:legendPos val="r"/><c:overlay val="0"/></c:legend><c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>'
        "</c:chart></c:chartSpace>"
    )


def anchor(index, chart, rel_id, shape_id):
    top = index * 18
    frame_name = f"Chart {shape_id - 1}"
    position = (
        f"<xdr:from><xdr:col>4</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{top}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from>"
        f"<xdr:to><xdr:col>12</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>{top + 16}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to>"
    )
    if chart["kind"] == "ofPie":
        frame = (
            f'<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="{shape_id}" name="{frame_name}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>'
            '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
            f'<a:graphic><a:graphicData uri="{C}"><c:chart xmlns:c="{C}" r:id="{rel_id}"/></a:graphicData></a:graphic></xdr:graphicFrame>'
        )
        return f'<xdr:twoCellAnchor editAs="oneCell">{position}{frame}<xdr:clientData/></xdr:twoCellAnchor>'
    requires, namespace = ("cx2", CX2) if chart["kind"] == "funnel" else ("cx1", CX1)
    choice = (
        f'<mc:Choice xmlns:{requires}="{namespace}" Requires="{requires}">'
        f'<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="{shape_id}" name="{frame_name}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>'
        '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>'
        f'<a:graphic><a:graphicData uri="{CX}"><cx:chart xmlns:cx="{CX}" r:id="{rel_id}"/></a:graphicData></a:graphic>'
        "</xdr:graphicFrame></mc:Choice>"
    )
    fallback = (
        f'<mc:Fallback><xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="{shape_id}" name="{frame_name}"/><xdr:cNvSpPr><a:spLocks noTextEdit="1"/></xdr:cNvSpPr></xdr:nvSpPr>'
        '<xdr:spPr><a:xfrm><a:off x="2438400" y="0"/><a:ext cx="4876800" cy="3048000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'
        '<a:solidFill><a:prstClr val="white"/></a:solidFill><a:ln w="1"><a:solidFill><a:prstClr val="green"/></a:solidFill></a:ln></xdr:spPr>'
        '<xdr:txBody><a:bodyPr vertOverflow="clip" horzOverflow="clip"/><a:lstStyle/><a:p><a:r><a:rPr lang="en-US" sz="1100"/>'
        "<a:t>This chart isn't available in your version of Excel.</a:t></a:r></a:p></xdr:txBody></xdr:sp></mc:Fallback>"
    )
    return (
        f'<xdr:twoCellAnchor editAs="oneCell">{position}'
        f'<mc:AlternateContent xmlns:mc="{MC}">{choice}{fallback}</mc:AlternateContent>'
        "<xdr:clientData/></xdr:twoCellAnchor>"
    )


def main():
    strings = []

    def shared(text):
        if text not in strings:
            strings.append(text)
        return strings.index(text)

    files = {}
    chart_number = 0
    chartex_number = 0
    overrides = []
    for sheet_index, sheet in enumerate(SHEETS, start=1):
        rows_xml = []
        for row_index, row in enumerate(sheet["rows"], start=1):
            cells = []
            for column_index, value in enumerate(row):
                if value is None:
                    continue
                reference = f"{column_name(column_index)}{row_index}"
                if isinstance(value, str):
                    cells.append(f'<c r="{reference}" t="s"><v>{shared(value)}</v></c>')
                else:
                    cells.append(f'<c r="{reference}"><v>{value}</v></c>')
            rows_xml.append(f'<row r="{row_index}">{"".join(cells)}</row>')
        files[f"xl/worksheets/sheet{sheet_index}.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<worksheet xmlns="{MAIN}" xmlns:r="{REL}"><sheetData>{"".join(rows_xml)}</sheetData><drawing r:id="rId1"/></worksheet>'
        )
        files[f"xl/worksheets/_rels/sheet{sheet_index}.xml.rels"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<Relationships xmlns="{PKG}"><Relationship Id="rId1" Type="{REL}/drawing" Target="../drawings/drawing{sheet_index}.xml"/></Relationships>'
        )
        anchors = []
        relations = []
        for chart_index, chart in enumerate(sheet["charts"]):
            rel_id = f"rId{chart_index + 1}"
            if chart["kind"] == "ofPie":
                chart_number += 1
                path = f"charts/chart{chart_number}.xml"
                files[f"xl/{path}"] = of_pie_part(sheet, chart)
                relations.append(f'<Relationship Id="{rel_id}" Type="{REL}/chart" Target="../{path}"/>')
                overrides.append(
                    f'<Override PartName="/xl/{path}" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>'
                )
            else:
                chartex_number += 1
                path = f"charts/chartEx{chartex_number}.xml"
                files[f"xl/{path}"] = chartex_part(sheet, chart)
                relations.append(f'<Relationship Id="{rel_id}" Type="{CHARTEX_REL}" Target="../{path}"/>')
                overrides.append(
                    f'<Override PartName="/xl/{path}" ContentType="application/vnd.ms-office.chartex+xml"/>'
                )
            anchors.append(anchor(chart_index, chart, rel_id, chart_index + 2))
        files[f"xl/drawings/drawing{sheet_index}.xml"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<xdr:wsDr xmlns:xdr="{XDR}" xmlns:a="{A}" xmlns:r="{REL}">{"".join(anchors)}</xdr:wsDr>'
        )
        files[f"xl/drawings/_rels/drawing{sheet_index}.xml.rels"] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            f'<Relationships xmlns="{PKG}">{"".join(relations)}</Relationships>'
        )
        overrides.append(
            f'<Override PartName="/xl/worksheets/sheet{sheet_index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        )
        overrides.append(
            f'<Override PartName="/xl/drawings/drawing{sheet_index}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>'
        )
    files["xl/workbook.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<workbook xmlns="{MAIN}" xmlns:r="{REL}"><sheets>'
        + "".join(
            f'<sheet name="{sheet["name"]}" sheetId="{index}" r:id="rId{index}"/>'
            for index, sheet in enumerate(SHEETS, start=1)
        )
        + "</sheets></workbook>"
    )
    count = len(SHEETS)
    files["xl/_rels/workbook.xml.rels"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<Relationships xmlns="{PKG}">'
        + "".join(
            f'<Relationship Id="rId{index}" Type="{REL}/worksheet" Target="worksheets/sheet{index}.xml"/>'
            for index in range(1, count + 1)
        )
        + f'<Relationship Id="rId{count + 1}" Type="{REL}/styles" Target="styles.xml"/>'
        + f'<Relationship Id="rId{count + 2}" Type="{REL}/sharedStrings" Target="sharedStrings.xml"/>'
        + "</Relationships>"
    )
    files["xl/styles.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<styleSheet xmlns="{MAIN}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
        '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'
    )
    files["xl/sharedStrings.xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<sst xmlns="{MAIN}" count="{len(strings)}" uniqueCount="{len(strings)}">'
        + "".join(f"<si><t>{escape(text)}</t></si>" for text in strings)
        + "</sst>"
    )
    files["_rels/.rels"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<Relationships xmlns="{PKG}"><Relationship Id="rId1" Type="{REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    )
    files["[Content_Types].xml"] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
        + "".join(overrides)
        + "</Types>"
    )
    with zipfile.ZipFile("office-2016-charts.xlsx", "w", zipfile.ZIP_DEFLATED) as archive:
        # The content types first, as Excel writes them.
        for name in ["[Content_Types].xml"] + sorted(name for name in files if name != "[Content_Types].xml"):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(info, files[name])


if __name__ == "__main__":
    main()
