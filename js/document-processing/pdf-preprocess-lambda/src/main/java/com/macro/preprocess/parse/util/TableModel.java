package com.macro.preprocess.parse.util;

import java.util.HashSet;
import java.util.TreeSet;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.javatuples.Pair;

import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextToken;

/**
 * Tools for determining what is a table and what is not and 
 * exporting tables out of the source document into seperate files.
 * @author Jacob
 */
public class TableModel {
	
	private volatile static int globalId = 0;
	public final int id = globalId++;
	boolean isHorizontal;
	TreeSet<TextToken> extracts;
	PDDocument pd;
	int pageNo;
	private static final float PAD = 15f;
	
	/**
	 * Extrapolate a table by bootstrapping from the given extracts
	 * @param ep
	 * @param extracts
	 */
	public TableModel(TreeSet<TextToken> extracts, int pageNo) {
		this.pd = extracts.first().getDocument();
		this.extracts = extracts;
		this.pageNo = pageNo;
	}
	
	public TableModel(TextBox t) {
		this.pd = t.getDocument();
		this.pageNo = t.getPageNum();
		TreeSet<TextToken> extracts = new TreeSet<TextToken>();
		for (PhysicalComponent p : t.getChildren()) {
			TextToken tt = (TextToken) p;
			extracts.add(tt);
		}
		this.extracts = extracts;
	}
	
	public String getTableHTMLEasyMethod() {
		TextBox parent0 = extracts.first().getParent();
		Pair<Float, Float> p1 = new Pair<Float,Float>(parent0.getX() - PAD, parent0.getY() - PAD);
		Pair<Float, Float> p2 = new Pair<Float,Float>(
				parent0.getX() + parent0.getWidth() + PAD, 
				parent0.getY() + parent0.getHeight() + PAD);
		Pair<Pair<Float, Float>, Pair<Float, Float>> b = new Pair<Pair<Float, Float>, Pair<Float, Float>>(p1, p2);
		return exportTable(b);
	}
	
	public String getTableHTML() {
		boolean easyCase = true;
		TextBox parent0 = extracts.first().getParent();
		for (TextToken t : this.extracts) {
			if (!t.getParent().equals(parent0)) {
				easyCase = false;
				break;
			}
		}
		if (easyCase) {
			Pair<Float, Float> p1 = new Pair<Float,Float>(parent0.getX() - PAD, parent0.getY() - PAD);
			Pair<Float, Float> p2 = new Pair<Float,Float>(
					parent0.getX() + parent0.getWidth() + PAD, 
					parent0.getY() + parent0.getHeight() + PAD);
			Pair<Pair<Float, Float>, Pair<Float, Float>> b = new Pair<Pair<Float, Float>, Pair<Float, Float>>(p1, p2);
			return exportTable(b);
		}
		else {
			this.isHorizontal = isHorizontal();
			return exportTable(getTableDims());
		}
	}
	
	private String exportTable(Pair<Pair<Float, Float>, Pair<Float, Float>> b) {
		// Can use SVG exported from PDF Renderer but have to change viewBox attribute
		float pageHeight = this.pd.getPage(0).getBBox().getHeight();
		float pageWidth = this.pd.getPage(0).getBBox().getWidth();
		String height = Float.toString(b.getValue1().getValue1() - b.getValue0().getValue1()) + "px";
		String topPx = Float.toString(b.getValue0().getValue1()) + "px";
		String top = Float.toString(b.getValue0().getValue1() / pageHeight * 100) + "%";
		String right =  Float.toString(100f - b.getValue1().getValue0() / pageWidth * 100) + "%";
		String bottom =  Float.toString(100f - b.getValue1().getValue1() / pageHeight * 100) + "%";
		String left =  Float.toString(b.getValue0().getValue0() / pageWidth * 100) + "%";
		String sourceFile = this.pageNo + ".svg";
		String css = "<style>.container {\n" + 
				"  position: relative;"
				+ "height: " + height + ";\n"
						+ "text-align: center;" + 
				"}\n" + 
				"#clip" + this.id + " {\n" + 
				"  clip-path: inset(" + top +" " + right +" " + bottom + " " + left + ");\n"
						+ "margin-top: -" + topPx + ";\n"
								+ "height: " + pageHeight + ";" + 
				"}\n</style>";
		String toret = "<div class=\"container\">\n" + 
				"  <img id=\"clip" + this.id + "\" src=\"" + sourceFile + "\" />\n" + 
				"</div>";
		return css + "\n" + toret;
	}
	
	public Pair<Pair<Float, Float>, Pair<Float, Float>> getTableDims() {
		if (isHorizontal) {
			return getHorizontalTable();
		}
		return getVerticalTable();
	}
	
	public Pair<Pair<Float, Float>, Pair<Float, Float>> getHorizontalTable() {
		return null; // TODO implement
	}
	
	public Pair<Pair<Float, Float>, Pair<Float, Float>> getVerticalTable() {
		TextBox last = extracts.last().getParent();
		Pair<Float, Float> botRight = new Pair<Float,Float>(last.getX() + last.getWidth() + PAD, last.getY() + last.getHeight() + PAD);
		TextBox first = extracts.first().getParent();
		Pair<Float, Float> topLeft = new Pair<Float,Float>(first.getX() - PAD, first.getY() - PAD);
		return new Pair<Pair<Float, Float>, Pair<Float, Float>>(topLeft, botRight);
	}
	
	/**
	 * @return true if the tokens are aligned on a horizontal line,
	 * false if aligned on a vertical line
	 */
	private boolean isHorizontal() {
		// Compute standard deviation
		float sumX = 0;
		float sumY = 0;
		for (TextToken t : extracts) {
			sumX += t.getX();
			sumY += t.getY();
		}
		float meanX = sumX / extracts.size();
		float meanY = sumY / extracts.size();
		float momentX = 0;
		float momentY = 0;
		for (TextToken t : extracts) {
			momentX += t.getX() - meanX;
			momentY += t.getY() - meanY;
		}
		return momentY < momentX;
	}
	
	/**
	 * Test if a given 
	 * @return
	 */
	public static boolean isProbablyTable(TextBox t) {
		float density = textDensity(t);
		float pctAligned = pctAligned(t);
		if ((density < .01) && (pctAligned > .068)) {
			return true;
		}
		if (density > .013) return false;
		if (pctAligned < .15f) return false;
		return true;
	}
	
	private static float textDensity(TextBox t) {
		float area = t.getWidth() * t.getHeight();
		int numChars = 0;
		for (PhysicalComponent p : t.getChildren()) {
			numChars += p.getChildren().size();
		}
		return numChars / area;
	}
	
	private static float pctAligned(TextBox t) {
		HashSet<Float> xs = new HashSet<Float>();
		float aligned = 0f;
		for (PhysicalComponent tt : t.getChildren()) {
			if (xs.contains(tt.getX())) {
				aligned++;
			}
			xs.add(tt.getX());
		}
		return aligned / (float) t.getChildren().size();
	}
}
