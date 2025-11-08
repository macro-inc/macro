package com.macro.preprocess.parse.ie.credit;

import java.io.UnsupportedEncodingException;
import java.util.Collection;
import java.util.NavigableSet;
import java.util.TreeSet;

import org.javatuples.Pair;

import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.logical.Definition;
import com.macro.preprocess.component.logical.SSection;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.parse.ExtractPhysical;
import com.macro.preprocess.parse.PDFDOM;
import com.macro.preprocess.parse.ie.ExtractorWidget;
import com.macro.preprocess.parse.ie.Result;
import com.macro.preprocess.parse.util.TableModel;

public class LeverageRatio extends ExtractorWidget {
	
	public static final String name = "Leverage Ratio";
	public static final CovenantType type = CovenantType.FINANCIAL;
	ExtractPhysical ep;
	TreeSet<TextToken> tmpTokens; // need to store temps in case want a table
	public LeverageRatio(PDFDOM dom, Collection<Result> masterResults, ExtractPhysical ep) {
		super(dom, name, masterResults);
		tmpTokens = new TreeSet<TextToken>();
		this.ep = ep;
	}

	@Override
	public void run() {
		for (SSection s : this.getDom().getAllSections()) {
			TreeSet<TextToken> title = s.getSectionTitle();
			boolean good = false;
			for (TextToken t : title) {
				if ((t != null) && (t.toString().toLowerCase().equals("ratio"))) {
					good = true;
					break;
				}
			}
			if (!good) continue;
			Pair<String, NavigableSet<PhysicalComponent>> extracted = this.extractRatioLiteral(s);
			String html = null;
			if (extracted == null) continue;
			if (!this.tmpTokens.isEmpty()) {
				TextToken first = tmpTokens.first();
				TreeSet<TextToken> samePage = new TreeSet<TextToken>();
				samePage.add(first);
				for (TextToken t : this.tmpTokens) {
					if (t.getPageNum() == first.getPageNum()) samePage.add(t);
				}
				if (samePage.size() >= 3) { // maybe a table
					TableModel tableModel = new TableModel(samePage, first.getPageNum());
					html = tableModel.getTableHTML();
				}
			}
			String asDefined = getDefinition(s.getSectionTitleString()); // also show the definition if it exists
			if (asDefined.isEmpty()) { // if the definition is not present then get the section text
				asDefined = s.getText();
			}
			Result newResult = new Result(extracted.getValue1(), s.getSectionTitleString(), extracted.getValue0() + 
					((html != null) ? "<br /><br />" + html : "") +
					 "<br /><br />" + asDefined, s, type);
			this.tmpTokens = new TreeSet<TextToken>(); // clear this for future iterations
			this.addResult(newResult);
		}
	}
	
	private String getDefinition(String definition) {
		Definition match = null;
		for (Definition d : this.dom.getAllDefinitions()) {
			if (d.getDefinitionTermString().toLowerCase().trim().equals(definition.toLowerCase().trim())) {
				match = d;
				break;
			}
		}
		if (match == null) return "";
		try {
			return match.getDefinitionXML();
		} catch (UnsupportedEncodingException e) {
			e.printStackTrace();
		}
		return "";
	}
	
	private Pair<String, NavigableSet<PhysicalComponent>> extractRatioLiteral(SSection s) {
		String f1 = null;
		
		TextBox finalbox = null;
		StringBuilder toret = new StringBuilder(); 
		for (TextBox t : s.getTboxes()) {
			for (PhysicalComponent p : t.getChildren()) {
				TextToken tt = (TextToken) p;
				String ratioParse = parseRatioString(tt.toString());
				if (ratioParse != null) {
					this.tmpTokens.add(tt);
					finalbox = t;
					toret.append(ratioParse + "; ");
				}
				if (f1 != null) {
					if ((!isFloat(tt.toString())) &&
						(!(tt.toString().equals(":") || (tt.toString().toLowerCase().equals("to"))))) {
						finalbox = t;
						f1 = null;
					}
				}
				if (isFloat(tt.toString())) {
					if (f1 != null) {
						toret.append(f1 + " to " + tt.toString() + "; ");
						finalbox = t;
						this.tmpTokens.add(tt);
						f1 = null;
					} else {
						f1 = tt.toString();
					}
				}
			}
		}
		TreeSet<PhysicalComponent> a = new TreeSet<PhysicalComponent>();
		if ((finalbox == null) || (finalbox.getChildren().isEmpty())) {
			return null;
		}
		a.add(finalbox);
		return new Pair<String, NavigableSet<PhysicalComponent>>(toret.toString(), a);
	}
	
	/**
	 * Parse "1.95:1.00"
	 * @return
	 */
	private String parseRatioString(String s) {
		if (!s.contains(":")) return null;
		String[] toks = s.split(":");
		if (toks.length != 2) return null;
		if ((!isFloat(toks[0])) || (!isFloat(toks[1]))) {
			return null;
		}
		return toks[0] + " to " + toks[1];
	}
	
	public static boolean isFloat(String s) {
		try {
			Float.parseFloat(s);
			return true;
		} catch (Exception e) {
			return false;
		}
	}
}
