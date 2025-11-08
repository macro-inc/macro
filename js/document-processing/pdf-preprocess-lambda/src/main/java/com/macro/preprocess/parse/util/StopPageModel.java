package com.macro.preprocess.parse.util;

import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.parse.ExtractPhysical;
import com.macro.preprocess.parse.PDFDOM;

/**
 * Detect whether a given page is the end of the main section of the document
 * @author Jacob
 *
 */
public class StopPageModel {
	
	ExtractPhysical ep;
	PDFDOM dom;
	
	public StopPageModel(ExtractPhysical ep, PDFDOM dom) {
		this.ep = ep;
		this.dom = dom;
	}
	
	public boolean isProbablyStopPage(int pageNo) {
		//if (pageNo < ep.document.getNumberOfPages() * .75) return false;
		//return isProbablySignaturePage(pageNo) || isProbablySchedulePage(pageNo);
		return false;
	}
	
	private boolean isProbablySignaturePage(int pageNo) {
		if (this.ep.getAllTokensForPage(pageNo).size() > 100) {
			return false;
		}
		short signaturePageLiteral = 0;
		short nameLiteral = 0;
		short titleLiteral = 0;
		short lenderLiteral = 0;
		short borrowerLiteral = 0;
		for (TextToken t : this.ep.getAllTokensForPage(pageNo)) {
			String lower = t.toString().toLowerCase().trim();
			if (lower.equals("name")) {
				nameLiteral = 1;
			} else if (lower.equals("title")) {
				titleLiteral = 1;
			} else if (lower.equals("lender")) {
				lenderLiteral = 1;
			} else if (lower.equals("borrower")) {
				borrowerLiteral = 1;
			} 
		}
		float goodToks = signaturePageLiteral+nameLiteral+titleLiteral+lenderLiteral+borrowerLiteral;
		return (goodToks / this.ep.getAllTokensForPage(pageNo).size()) > .30f;
	}
	
	private boolean isProbablySchedulePage(int pageNo) {
		TextToken first = this.ep.getAllTokensForPage(0).first();
		if (first.getX() < this.ep.document.getPage(pageNo).getBBox().getWidth() * .25f) {
			return false;
		}
		String fstr = first.toString().toLowerCase().trim();
		if (fstr.equals("exhibit") || fstr.equals("schedule")) {
			if (first.getParent().getChildren().size() < 5) {
				return true;
			}
		}
		return false;
	}
}
