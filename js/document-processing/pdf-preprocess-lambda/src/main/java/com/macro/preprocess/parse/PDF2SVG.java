package com.macro.preprocess.parse;

import java.awt.GraphicsConfiguration;
import java.awt.GraphicsDevice;
import java.awt.Rectangle;
import java.awt.geom.AffineTransform;
import java.awt.image.ColorModel;
import java.io.IOException;
import java.io.StringWriter;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.TreeSet;
import javax.xml.transform.Transformer;
import javax.xml.transform.TransformerFactory;
import javax.xml.transform.dom.DOMSource;
import javax.xml.transform.stream.StreamResult;
import org.apache.batik.dom.GenericDOMImplementation;
import org.apache.batik.svggen.SVGGeneratorContext;
import org.apache.batik.svggen.SVGGraphics2D;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.mabb.fontverter.FVFont;
import org.mabb.fontverter.FontVerter.FontFormat;
import org.mabb.fontverter.pdf.PdfFontExtractor;
import org.w3c.dom.DOMImplementation;
import org.w3c.dom.Document;
import org.w3c.dom.Element;
import org.w3c.dom.NamedNodeMap;
import org.w3c.dom.NodeList;
import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.parse.util.PeekIterator;

/**
 * Convert PDF file to SVG file while maintaining text.
 * 
 * @author Jacob
 */
public class PDF2SVG {

	final static float DOCUMENT_WIDTH = 600f;
	final static float LINE_ADJUST = .76f;
	final static float LINE_ADJUST_INCREMENT = .1f;

	PDDocument document;
	ExtractPhysicalWrapper extractor;
	public ExtractEmbeddedFonts ebf;
	volatile HashMap<Integer, String> pageToSvg;
	HashMap<String, String> nameToClean = new HashMap<String, String>();
	private boolean done = false;
	int id = 0;

	public PDF2SVG(ExtractPhysicalWrapper extractor, PDDocument document) throws IOException {
		this.extractor = extractor;
		this.document = document;
		this.pageToSvg = new HashMap<Integer, String>();
		ebf = new ExtractEmbeddedFonts(document);
	}

	public void processDocument() throws Exception {
		SVGGeneratorContext ctx = createContext();

		// EXECUTE CONVERTERS
		for (int pageCounter = 0; pageCounter < document.getNumberOfPages(); pageCounter++) {
			while (((pageCounter > this.extractor.getCurrentPageNo() - 15)
					&& (this.extractor.getCurrentPageNo() < this.extractor.getNumberOfPages()))) {
				/* SPIN LOCK */
			}
			this.processPage(pageCounter, ctx, document.getPage(pageCounter));
		}
		
		this.done = true;
	}

	/**
	 * Create the SVG representation of a page and dispatch other methods to do
	 * heavy lifting.
	 * 
	 * @param tspan
	 * @param token
	 */
	// TODO change return type to string and above in the inner class write to file
	// if inMemory is false
	private void processPage(int pageCounter, SVGGeneratorContext ctx, PDPage page)
			throws Exception {
		SVGGraphics2D g = createGraphics(ctx);
		// pdfRenderer.renderPageToGraphics(pageCounter, g);

		// CREATE PAGE STATISTICS DATA STRUCTURES
		HashMap<String, Integer> sizeToFreq = new HashMap<String, Integer>();
		HashMap<String, Integer> nameToFreq = new HashMap<String, Integer>();

		// CREATE DOCUMENT METADATA
		Element tle = g.getRoot();
		tle.setAttribute("width", "100%");
		tle.setAttribute("page", Integer.toString(pageCounter));
		tle.setAttribute("viewBox", "0 0 " + page.getBleedBox().getWidth() + " " + page.getBleedBox().getHeight());
		Document owner = tle.getOwnerDocument();

		Element gelm = (Element) tle.getElementsByTagName("g").item(0);
		gelm.setAttribute("pointer-events", "none");

		// CREATE ACTUAL PAGE DATA
		TreeSet<TextBox> tbSet = this.extractor.getAllBoxesForPage(pageCounter);
		for (TextBox tbox : tbSet) {
			Element textg = tle; // don't create a new <g> for each text anymore
			Element textbox = owner.createElement("text");
			this.processTextBox(pageCounter, textbox, tbox, owner, textg, sizeToFreq, nameToFreq);
			textg.appendChild(textbox);
		}

		String defaultFont = "Times New Roman";
		int maxFontFreq = 0;
		for (Map.Entry<String, Integer> kv : nameToFreq.entrySet()) {
			int freq = kv.getValue();
			if (freq > maxFontFreq) {
				maxFontFreq = freq;
				defaultFont = kv.getKey();
			}
		}
		String defaultSize = "12";
		int maxSizeFreq = 0;
		for (Map.Entry<String, Integer> kv : sizeToFreq.entrySet()) {
			int freq = kv.getValue();
			if (freq > maxSizeFreq) {
				maxSizeFreq = freq;
				defaultSize = kv.getKey();
			}
		}

		tle.setAttribute("font-family", defaultFont);
		tle.setAttribute("font-size", defaultSize);

		NodeList tspans = tle.getElementsByTagName("tspan");
		for (int i = 0; i < tspans.getLength(); i++) {
			Element tspan = (Element) tspans.item(i);
			if (tspan.getAttribute("font-family").equals(defaultFont)) {
				tspan.removeAttribute("font-family");
			}
			if (tspan.getAttribute("font-size").equals(defaultSize)) {
				tspan.removeAttribute("font-size");
			}
		}
		// More optimizations:
		tle.removeChild(tle.getFirstChild()); // remove "<!----->"
		tle.removeChild(tle.getFirstChild()); // remove genericDefs
		NamedNodeMap attrs = tle.getAttributes();
		HashSet<String> strokeAttrs = new HashSet<String>();
		for (int i = 0; i < attrs.getLength(); i++) {
			String attr = attrs.item(i).getNodeName();
			if (attr.toLowerCase().contains("stroke")) {
				strokeAttrs.add(attr);
			}
		}
		for (String name : strokeAttrs) {
			attrs.removeNamedItem(name);
		}

		// CREATE OUTPUT FILE
		TransformerFactory transformerFactory = TransformerFactory.newInstance();
		Transformer transformer = transformerFactory.newTransformer();
		DOMSource source = new DOMSource(tle);
		StringWriter sw = new StringWriter();
		StreamResult result = new StreamResult(sw);
		transformer.transform(source, result);
		sw.flush();
		this.pageToSvg.put(pageCounter, sw.toString());
	}

	/**
	 * Create the SVG representation of a textbox and dispatch other methods as
	 * necessary.
	 * 
	 * @param tspan
	 * @param token
	 */
	private void processTextBox(int pageCounter, Element textbox, TextBox tbox, Document owner, Element textg,
			HashMap<String, Integer> sizeToFreq, HashMap<String, Integer> nameToFreq) {
		PeekIterator<PhysicalComponent> ttIter = new PeekIterator<PhysicalComponent>(tbox.getChildren());
		while (ttIter.hasNext()) {
			// Create tspan, may just hold a token or may be nested
			TextToken token = (TextToken) ttIter.next();
			Element tspan = owner.createElement("tspan");
			this.processToken(pageCounter, tspan, token, owner, textg, sizeToFreq, nameToFreq);
			textbox.appendChild(tspan);
		}
		if (tbox.getLogicalOwner() != null) {
			textbox.setAttribute("id", Integer.toString(tbox.getLogicalOwner().getSection().id));
		}
	}

	/**
	 * Create the SVG representation of a token and dispatch other methods as
	 * necessary.
	 * 
	 * @param tspan
	 * @param token
	 */
	private void processToken(int pageCounter, Element tspan, TextToken token, Document owner, Element textg,
			HashMap<String, Integer> sizeToFreq, HashMap<String, Integer> nameToFreq) {
		tspan.setAttribute("id", "t_" + Integer.toString(id++));
		tspan.setAttribute("x", formatNum(token.getX()));

		String fontNameClean = "Times New Roman"; // fallback
		if ((token.getFont() != null) && (token.getFont().getName() != null))
			fontNameClean = getClean(token.getFont().getName());

		FVFont font = null;

		if (!isStoredFont(fontNameClean) && (!this.ebf.isDefaultFont(fontNameClean))) {
			try {
				font = PdfFontExtractor.convertFont(token.getFont(), FontFormat.OTF);
				this.ebf.writeFont(font, fontNameClean);
			} catch (Exception e) {
			}
		}

		if (!isStoredFont(fontNameClean)) {
			// Try to clean font up and hope it's stored as a default font
			String name = fontNameClean;
			name = name.replaceAll("bold|Bold|italic|Italic|MT", "");
			tspan.setAttribute("font-family", name);
			nameToFreq.put(name, nameToFreq.getOrDefault(name, 0) + 1);
		} else {
			String fontName = this.ebf.getNumber(fontNameClean);
			tspan.setAttribute("font-family", fontName);
			nameToFreq.put(fontName, nameToFreq.getOrDefault(fontName, 0) + 1);
		}
		String name = fontNameClean.toLowerCase();
		if (name.contains("bold"))
			tspan.setAttribute("font-weight", "bold");
		if (name.contains("italic"))
			tspan.setAttribute("font-style", "italic");
		else if (name.contains("oblique"))
			tspan.setAttribute("font-style", "oblique");

		String size = formatNum(token.getCssHeight());
		tspan.setAttribute("font-size", size);
		sizeToFreq.put(size, sizeToFreq.getOrDefault(size, 0) + 1);

		if ((token.getPrevToken() != null) && (Math.abs(token.getPrevToken().getY() - token.getY()) < 1f)) {
			// Pass, don't do anything, SVG automatically will display at the same height as
			// the prevToken
		} else {
			tspan.setAttribute("y", formatNum(token.getY() + getIncreaseHeight(token.getHeight()))); // approximate
		}
		tspan.setTextContent(token.toString().trim() + (token.isHasEndingSpace() ? " " : ""));
	}
	
	/**
	 * Returns a shortname for a font name
	 * @param dirty
	 * @return
	 */
	private String getClean(String dirty) {
		// Try getting cached name to avoid regex
		String cached = this.nameToClean.get(dirty);
		if (cached != null) return cached;
		
		// Compute, cache, and return shortname
		String clean = dirty;
		if (clean.contains("+")) {
			clean = clean.substring(clean.indexOf('+'));
		}
		clean = clean.replaceAll("[^a-zA-Z0-9]", "");
		this.nameToClean.put(dirty, clean);
		return clean;
	}

	private float getIncreaseHeight(Float tokenHeight) {
		if (tokenHeight < 12) {
			return LINE_ADJUST * tokenHeight;
		}
		return (LINE_ADJUST - LINE_ADJUST_INCREMENT) * tokenHeight;
	}

	private boolean isStoredFont(String queryName) {
		for (String storedName : this.ebf.fontNames.keySet()) {
			if (queryName.equals(storedName))
				return true;
		}
		return false;
	}

	public static String formatNum(double d) {
		if (d == (int) d)
			return String.format("%d", (int) d);
		else
			return String.format("%.2f", d);
	}

	private static SVGGraphics2D createGraphics(SVGGeneratorContext ctx) {
		SVGGraphics2D g2d = new CustomSVGGraphics2D(ctx, false);
		return g2d;
	}

	private static SVGGeneratorContext createContext() {
		DOMImplementation impl = GenericDOMImplementation.getDOMImplementation();
		String svgNS = "http://www.w3.org/2000/svg";
		Document myFactory = impl.createDocument(svgNS, "svg", null);

		SVGGeneratorContext ctx = SVGGeneratorContext.createDefault(myFactory);
		ctx.setComment("");
		return ctx;
	}

	public static class CustomSVGGraphics2D extends SVGGraphics2D {

		public CustomSVGGraphics2D(SVGGeneratorContext generatorCtx, boolean textAsShapes) {
			super(generatorCtx, textAsShapes);
		}

		@Override
		public GraphicsConfiguration getDeviceConfiguration() {
			return new CustomGraphicsConfiguration();
		}
	}

	private static final class CustomGraphicsConfiguration extends GraphicsConfiguration {

		@Override
		public AffineTransform getNormalizingTransform() {
			return null;
		}

		@Override
		public GraphicsDevice getDevice() {
			return null;
		}

		@Override
		public AffineTransform getDefaultTransform() {
			return null;
		}

		@Override
		public ColorModel getColorModel(int transparency) {
			return null;
		}

		@Override
		public ColorModel getColorModel() {
			return null;
		}

		@Override
		public Rectangle getBounds() {
			return null;
		}

	}

	private static final class CustomGraphicsDevice extends GraphicsDevice {
		@Override
		public int getType() {
			return 0;
		}

		@Override
		public String getIDstring() {
			return null;
		}

		@Override
		public GraphicsConfiguration[] getConfigurations() {
			return null;
		}

		@Override
		public GraphicsConfiguration getDefaultConfiguration() {
			return null;
		}
	}

	public Map<Integer, String> getPageToSvg() {
		return this.pageToSvg;
	}

	public Map<String, String> getFontToBytes() {
		return this.ebf.fnameToBytes;
	}
	
	public boolean isDone() {
		return this.done;
	}
}