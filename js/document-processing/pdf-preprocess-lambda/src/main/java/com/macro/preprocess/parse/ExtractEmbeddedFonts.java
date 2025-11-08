package com.macro.preprocess.parse;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.mabb.fontverter.*;
import java.io.IOException;
import java.util.Base64;
import java.util.HashMap;
import java.util.HashSet;

public class ExtractEmbeddedFonts {

	protected HashMap<String, String> fontNames;
	protected HashMap<String, String> fnameToBytes;
	HashSet<String> defaultFonts;
	private int currentName = 0;

	public ExtractEmbeddedFonts(PDDocument document) {
		this.fontNames = new HashMap<String, String>(); // map from pdf_name to fname (e.g. ajsdnA -> f1)
		this.fnameToBytes = new HashMap<String, String>(); // map from fname to bytes (e.g. f1 -> jasnaljsdnfjNASNJD0101DNaksnd...)
		this.defaultFonts = new HashSet<String>(); // cache so don't have to compute default every time
	}

	public void writeFont(FVFont font, String fontNameClean) throws IOException, InterruptedException {
		if ((font == null) || (font.getName() == null) || this.fontNames.containsKey(fontNameClean)) {
			return;
		}
		if (isDefaultFont(fontNameClean)) return;
		String fname =  "f" + Integer.toString(++this.currentName);
		this.fontNames.put(fontNameClean, fname);
		this.fnameToBytes.put(fname, "data:font/" + font.getProperties().getCssFontFaceFormat()
				+ ";charset=utf-8;base64," + Base64.getEncoder().encodeToString(font.getData()));
	}

	public String getNumber(String name) {
		try {
			return this.fontNames.get(name);
		} catch (Exception e) { return "none"; }
	}

	public boolean isDefaultFont(String fontName) {
		if (this.defaultFonts.contains(fontName)) return true; // check cache
		String fontNameClean = fontName.replaceAll("[^a-zA-Z0-9]", "").toLowerCase();
		boolean isDefault = false;
		if (fontNameClean.contains("timesnewroman")) isDefault = true;
		else if (fontNameClean.contains("arial")) isDefault = true; // add to cache
		if (isDefault) this.defaultFonts.add(fontNameClean);
		return isDefault;
	}
}