package com.macro.preprocess.parse.util;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.TreeSet;

import com.google.common.primitives.Ints;
import com.macro.preprocess.component.logical.SSection;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.parse.ExtractLogical;
import com.macro.preprocess.parse.ExtractPhysicalWrapper;

/**
 * Utility class for determining whether a given pageId in a docuent is a TOC Page or Cover Page
 * @author Jacob
 */
public class TOCFinder {

	public ExtractPhysicalWrapper ep;
	// Caches
	HashSet<Integer> coverPages;
	HashSet<Integer> tocPages;

	public TOCFinder(ExtractPhysicalWrapper ep) {
		this.ep = ep;
		this.tocPages  = new HashSet<Integer>();
		this.coverPages = new HashSet<Integer>();
	}

	/**
	 * Fuzzy TOC page identification
	 * 
	 * @param pageId
	 *            the page of interest
	 * @return true if is a TOC page
	 */
	public boolean isTocPage(int pageId, int totalPages, boolean prevIsToc) {
		if (this.tocPages.contains(pageId)) return true;
		if (this.coverPages.contains(pageId)) return true;
		if (totalPages <= 9) return false;
		if (pageId == 0) return false; // generally, no TOC is ever on the first page...
		if (pageId > 25 && !prevIsToc && this.tocPages.isEmpty()) return false;
		float fuzzyBool = 0;
		if ((prevIsToc) && (totalPages > 10)) fuzzyBool += 0.1;
		if ((prevIsToc) && (totalPages > 40)) fuzzyBool += 0.4;
		if (pageId > 10) fuzzyBool -= 0.1;
		if (pageId >= 6 && (!prevIsToc)) fuzzyBool -= .5f;
		if (pageId == 0) fuzzyBool += .6f;
		if (this.ep.getAllTokensForPage(pageId).size() > 800) return false;
		if (this.ep.getAllBoxesForPage(pageId).isEmpty()) return false;
		
		TreeSet<TextToken> allTokens = this.ep.getAllTokensForPage(pageId);
		ArrayList<TextToken> sectionLiterals = new ArrayList<TextToken>();
		ArrayList<TextToken> sectionNumbers = new ArrayList<TextToken>();
		int nonSpecials = 0;
		
		for (TextToken t : allTokens) {
			if ((SSection.isSectionLiteral(t)) && (t.getX() < 200f)) {
				sectionLiterals.add(t);
			} else if (SSection.isSectionNumber(t, false, true) && (t.getX() < 200f)) {
				Integer i;
				if ( (i = Ints.tryParse(t.toString())) != null ) {
					if (i < 1950) {
						sectionNumbers.add(t);
					} // Don't add if it's actually a date
				} else {
					sectionNumbers.add(t);
				}
			}
			else {
				nonSpecials ++;
			}
		}
		
		if (nonSpecials < 50) fuzzyBool += .2f;
		
		float specicalToNon = (sectionLiterals.size() + sectionNumbers.size()) / (nonSpecials+.01f);
		
		if (specicalToNon > 0.25) fuzzyBool += .15f;
		if (specicalToNon < 0.15) fuzzyBool -= .4f;
		if (specicalToNon < 0.08) fuzzyBool -= 1f;
		if ((specicalToNon < 0.04) && (nonSpecials > 100)) return false;
		
		if (sectionLiterals.size() > 5) fuzzyBool += .15f;
		if (sectionNumbers.size() > 5) fuzzyBool += .2f;
		if (sectionNumbers.size() > 8) fuzzyBool += .15f;
		
		int numAligned = 0;
		for (int i = 0; i < sectionLiterals.size() - 1; i++) {
			if (Math.abs(sectionLiterals.get(i).getX() - sectionLiterals.get(i+1).getX()) < 5f) {
				numAligned += 1;
			}
		}
		
		TextBox firstBox = this.ep.getAllBoxesForPage(pageId).first();
		if (!firstBox.getChildren().isEmpty()) {
			TextToken first = (TextToken) firstBox.getChildren().first();
			if ((first.toString().toLowerCase().trim().equals("schedule"))
				&& firstBox.isCentered()
				&& pageId > 10
				&& numAligned < 5) {
				return false;
			}
		}
		
		fuzzyBool += numAligned / 8f;
		
		int numAligned2 = 0;
		for (int i = 0; i < sectionNumbers.size() - 1; i++) {
			if (Math.abs(sectionNumbers.get(i).getX() - sectionNumbers.get(i+1).getX()) < 5f) {
				numAligned2 += 1;
			}
		}
		
		fuzzyBool += numAligned2 / 8f;
	
		for (TextBox tbox : this.ep.getAllBoxesForPage(pageId)) {
			if (ExtractLogical.containsMeansKeyword(tbox)) {
				fuzzyBool -= .5f;
			}
		}
		if (fuzzyBool > 0.2) {
			this.tocPages.add(pageId);
			return true;
		}
		return false;
	}
	
	public boolean isCoverPage(int pageId, int totalPages) {
		if (this.coverPages.contains(pageId)) return true;
		if (this.coverPages.contains(pageId - 1)) return false; // dont allow two in a row
		if (pageId > totalPages * 0.9) return false;
		if (totalPages < 10) return false;
		if ((pageId == 0) && (this.ep.getNumberOfPages() > 10)) {
			if (this.ep.getAllBoxesForPage(pageId + 1).size() < 3) return true;
		}
		
		TextBox firstBox = this.ep.getAllBoxesForPage(pageId).first();
		if (!firstBox.getChildren().isEmpty()) {
			TextToken first = (TextToken) firstBox.getChildren().first();
			if ((first.toString().toLowerCase().trim().equals("schedule"))
				&& firstBox.isCentered()
				&& pageId > 10) {
				return false;
			}
		}
		
		short fuzzy = 0;
		if (totalPages < 15) fuzzy -= 5;
		if (this.isTocPage(pageId + 1, totalPages, false)) {
			fuzzy += 8;
		} else {
			return false;
		}
		int num = this.ep
					.getAllBoxesForPage(pageId)
					.parallelStream()
					.map(a -> a.isProbablyTitle(this.ep.getModeCharSize()) && a.getX() > 150)
					.mapToInt(a -> a ? 1: 0)
					.sum();
		
		fuzzy += Math.min(10, num);
		if (fuzzy > 8) {
			this.coverPages.add(pageId);
			return true;
		}
		return false;
	}
}
