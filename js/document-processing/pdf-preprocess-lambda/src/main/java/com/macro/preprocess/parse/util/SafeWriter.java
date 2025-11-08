package com.macro.preprocess.parse.util;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.PrintWriter;
import java.io.UnsupportedEncodingException;
import java.io.Writer;
import java.util.ArrayList;
import java.util.List;
import java.util.NavigableSet;
import java.util.TreeSet;

import org.apache.pdfbox.pdmodel.font.PDFont;

import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.logical.Definition;
import com.macro.preprocess.component.logical.Reference;
import com.macro.preprocess.component.logical.SSection;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextChar;
import com.macro.preprocess.component.physical.TextToken;

public class SafeWriter extends PrintWriter {
	public SafeWriter(File file) throws FileNotFoundException {
		super(file);
	}

	public SafeWriter(Writer swriter) throws FileNotFoundException {
		super(swriter);
	}

	@Override
	public void print(String line) {
		String safeline = line.replace("&", "&amp;");
		super.print(safeline);
	}

	public void printUnsafe(String line) {
		super.print(line);
	}

	public static String safeStr(String s) {
		if (s == null) {
			s = "";
		}
		StringBuilder out = new StringBuilder(Math.max(16, s.length()));
		for (int i = 0; i < s.length(); i++) {
			char c = s.charAt(i);
			if (c > 127 || c == '"' || c == '<' || c == '>' || c == '&' || c == '\'') {
				out.append("&#");
				out.append((int) c);
				out.append(';');
			} else {
				out.append(c);
			}
		}
		return out.toString();
	}

	public static String getXML(NavigableSet<TextBox> set) throws UnsupportedEncodingException {
		StringBuilder toret = new StringBuilder();
		TextToken lastToken = (TextToken) set.last().getChildren().last();
		boolean isSpecialOld = false;
		boolean isSpecialNew = false;
		toret.append("\n		<span>");
		for (TextBox tbox : set) {
			// TODO: terms are sometimes incorrectly marked as tables
			if (TableModel.isProbablyTable(tbox)) {
				TableModel tModel = new TableModel(tbox);
				toret.append("</span>\n");
				toret.append(tModel.getTableHTMLEasyMethod());
				toret.append("\n		<span>");
				continue;
			}
			for (PhysicalComponent p : tbox.getChildren()) {
				TextToken t = (TextToken) p;
				List<TextChar> textChars = new ArrayList<TextChar>();
				for (PhysicalComponent tc : t.getChildren()) {
					textChars.add((TextChar) tc);
				}
				isSpecialNew = t.getLogicalOwner() instanceof Reference;
				if ((!isSpecialNew) && isSpecialOld) {
					toret.append("</span>");
					toret.append("\n		<span>");
				} else if (isSpecialNew && (!isSpecialOld)) {
					toret.append("</span>\n		<span ");
					boolean isSection = ((Reference<?>) t.getLogicalOwner()).getPointerTo() instanceof SSection;
					if (isSection) {
						SSection ss = (SSection) ((Reference<?>) t.getLogicalOwner()).getPointerTo();
						toret.append("class='sref' ");
						toret.append("secId='" + ss.id + "'>");
					} else {
						Definition d = (Definition) ((Reference<?>) t.getLogicalOwner()).getPointerTo();
						toret.append("class='tref' ");
						toret.append("defId='" + d.id + "'>");
					}
				}
				toret.append(SafeWriter.safeStr(t.toString()) + (t.isHasEndingSpace() && (!t.equals(lastToken)) ? " " : ""));
				isSpecialOld = isSpecialNew;
			}
			toret.append("<br />");
		}
		toret.append("</span>\n");
		return toret.toString();
	}

	public static String getXML(TreeSet<TextToken> set) {
		if (set.isEmpty())
			return null;
		StringBuilder toret = new StringBuilder();
		TextToken lastToken = set.last();
		boolean isSpecialOld = false;
		boolean isSpecialNew = false;
		toret.append("\n		<span>");
		for (TextToken t : set) {
			List<TextChar> textChars = new ArrayList<TextChar>();
			for (PhysicalComponent tc : t.getChildren()) {
				textChars.add((TextChar) tc);
			}
			isSpecialNew = t.getLogicalOwner() instanceof Reference;
			if ((!isSpecialNew) && isSpecialOld) {
				toret.append("</span>");
				toret.append("\n		<span>");
			} else if (isSpecialNew && (!isSpecialOld)) {
				toret.append("</span>\n		<span ");
				boolean isSection = ((Reference<?>) t.getLogicalOwner()).getPointerTo() instanceof SSection;
				if (isSection) {
					SSection ss = (SSection) ((Reference<?>) t.getLogicalOwner()).getPointerTo();
					toret.append("class='sref' ");
					toret.append("secId='" + ss.id + "'>");
				} else {
					Definition d = (Definition) ((Reference<?>) t.getLogicalOwner()).getPointerTo();
					toret.append("class='tref' ");
					toret.append("defId='" + d.id + "'>");
				}
			}
			toret.append(SafeWriter.safeStr(t.toString()) + (t.isHasEndingSpace() && (!t.equals(lastToken)) ? " " : ""));
			isSpecialOld = isSpecialNew;
		}
		toret.append("</span>\n");
		return toret.toString();
	}
}
