package com.macro.preprocess.parse;

import java.io.FileNotFoundException;
import java.io.IOException;
import java.io.UnsupportedEncodingException;
import java.util.*;

import org.apache.commons.lang3.mutable.MutableInt;
import org.apache.pdfbox.pdmodel.font.PDFont;

import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.logical.Definition;
import com.macro.preprocess.component.logical.Definition.DefType;
import com.macro.preprocess.component.logical.Reference;
import com.macro.preprocess.component.logical.SSection;
import com.macro.preprocess.component.logical.SSection.NumberingType;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.parse.ie.credit.LeverageRatio;
import com.macro.preprocess.parse.util.DefinitionFinder;
import com.macro.preprocess.parse.util.PeekIterator;
import com.macro.preprocess.parse.util.SafeWriter;
import com.macro.preprocess.parse.util.TOCFinder;
import com.macro.preprocess.parse.util.TableModel;

/**
 * Extracts logical components from a document to build a PDFDOM object.
 *
 * @author Jacob, Sam
 */
public class ExtractLogical {
	final String BULLET = "•";
	final String OPEN_QUOTE = "“";
	final String CLOSE_QUOTE = "”";
	final int MAX_DEF_SIZE = 20;

	ExtractPhysicalWrapper ep;
	int pageNo;
	PDFDOM pdfDom;
	boolean lastWasDefinition;
	static String[] stopwords = { "i", "this", "the", "shall", "mean", "a", "it", "its", "their", "is", "am", "be",
			"do", "does", "did", "if", "are", "from", "to", "in", "an", "of", "is", "by", "on" };
	static HashSet<String> stopwordsSet = new HashSet<>(Arrays.asList(stopwords));
	final List<String> skipOverWords = Arrays.asList("A", "The", "a", "the", BULLET);
	private TOCFinder tf;
	boolean isFirstTitle = true;
	MutableInt curSecId;
	MutableInt curDefId;
	DefinitionFinder defFinder = null;
	AnomalyDetector anomalyDetector;

	public ExtractLogical(ExtractPhysicalWrapper ep, AnomalyDetector anomalyDetector) throws IOException {
		this.ep = ep;
		this.pageNo = 0;
		this.pdfDom = new PDFDOM(anomalyDetector);
		this.curSecId = new MutableInt();
		this.curDefId = new MutableInt();
		this.anomalyDetector = anomalyDetector;
	}

	/**
	 * Dispatcher method for specific parsers. We do two passes through the
	 * document: first to extract representative mentions and a second to extract
	 * references to those. TODO parallelize dispatching each subparser? Each for
	 * loop could be done on a page by page basis
	 *
	 * @throws FileNotFoundException
	 * @throws UnsupportedEncodingException
	 */
	public PDFDOM extract() throws FileNotFoundException, UnsupportedEncodingException {
		System.out.println("Extracting logical components...");
		tf = new TOCFinder(this.ep);
		boolean prevIsToc = false;
		for (int page = 0; page < this.ep.getNumberOfPages(); page++) {
			boolean isToc = tf.isTocPage(pageNo, this.ep.getNumberOfPages(), prevIsToc);
			if (isToc) {
				pdfDom.addTocPage(pageNo);
			}
			boolean isFirstNonHeaderTextboxForPage = true;
			for (TextBox tbox : this.ep.getAllBoxesForPage(pageNo)) {
				tbox.isProbablyTitle(this.ep.getModeCharSize());
				boolean isProbablyFooter = tbox.isProbablyFooter(this.ep.getAllBoxesForPage(pageNo));
				boolean isProbablyHeader = tbox.isProbablyHeader(this.ep.getAllBoxesForPage(pageNo));
				if ((!isToc)) {
					this.extractSection(tbox, isFirstNonHeaderTextboxForPage);
				}
				this.extractDefinition(tbox);
				if (!(isProbablyFooter || isProbablyHeader)) {
					pdfDom.getCurrentSection().addTbox(tbox);
				}
				if ((lastWasDefinition) && !(isProbablyFooter || isProbablyHeader)) {
					pdfDom.currentDefinition.addToDefinitionBody(tbox);
				}
				if (!isProbablyHeader)
					isFirstNonHeaderTextboxForPage = false; // this means that next iteration is no longer first tbox
			}
			prevIsToc = isToc;
			this.pageNo++;
		}
		Map<String, TreeSet<Definition>> termToDefList = this.pdfDom.getStemmedTermToDeflist();
		this.defFinder = new DefinitionFinder(termToDefList);
		anomalyDetector.detectDuplicateDefinitions(termToDefList);
		this.pdfDom.readOnly = true;
		this.pageNo = 0;
		for (int p = 0; p < this.ep.getNumberOfPages(); p++) {
			for (TextBox tbox : this.ep.getAllBoxesForPage(pageNo)) {
				if (tbox.getLogicalOwner() != null) { // footers et al
					this.extractSectionReferences(tbox, tbox.getLogicalOwner().getSection(), pdfDom.isTocPage(pageNo),
							!pdfDom.isTocPage(pageNo));
					this.extactDefinitionReferences(tbox);
				}
				if (!pdfDom.isTocPage(pageNo)) {
					anomalyDetector.detectUndefinedTerms(tbox, termToDefList);
				}
			}
			this.pageNo++;
		}
		anomalyDetector.detectUnusedDefinitions(termToDefList);
		anomalyDetector.detectUncapitalizedDefinitionReferences(termToDefList);
		return this.pdfDom;
	}

	/**
	 * Use a FSA to determine whether any references are in this textbox.
	 *
	 */
	private void extactDefinitionReferences(TextBox tbox) {
		defFinder.createReferences(tbox);
	}

	/**
	 * Find references to sections within a paragraph.
	 *
	 * @param tbox           the textbox of interest
	 * @param owningSection  the current owning section
	 * @param includeFirst   include the first literal in the search?
	 * @param requireLiteral require a section literal e.g. "section" to come before
	 *                       the section number
	 */
	private void extractSectionReferences(TextBox tbox, SSection owningSection, boolean includeFirst,
			boolean requireLiteral) {
		// fuzzy logic to accept "may be under Section 2.03(c)(iii), 2.03(a)(i), or
		// 2.08(b) or under Article VIII"
		int toksSinceLastLiteral = Integer.MAX_VALUE / 10;

		TextToken sectionToken = null;

		// Don't try to access anything if children is empty
		TreeSet<PhysicalComponent> tboxChildren = tbox.getChildren();
		NavigableSet<PhysicalComponent> searchSet;
		if (tboxChildren.isEmpty()) {
			searchSet = tboxChildren;
		} else {
			searchSet = includeFirst
				? tboxChildren
				: tboxChildren.tailSet(tboxChildren.first(), false);
		}

		PeekIterator<PhysicalComponent> iter = new PeekIterator<>(searchSet);
		String sectionLiteral = "";
		while (iter.hasNext()) {
			toksSinceLastLiteral += 1;
			TextToken token = (TextToken) iter.next();
			if (!requireLiteral) {
				if (token.getX() > 300)
					continue;
			}
			if ((toksSinceLastLiteral < 15) || (!requireLiteral)) {
				if (SSection.isSectionLiteralReference(token)) {
					toksSinceLastLiteral = 0;
					sectionToken = token;
					sectionLiteral = token.toString();
				} else if (LeverageRatio.isFloat(token.toString()) && Float.parseFloat(token.toString()) > 10000) {
					sectionLiteral = "";
					toksSinceLastLiteral = Integer.MAX_VALUE / 10;
				} else if (token.toString().toLowerCase().equals("code")) {
					sectionLiteral = "";
					toksSinceLastLiteral = Integer.MAX_VALUE / 10;
				} else if (token.toString().replace(".", "").trim().length() == 0) {
					sectionLiteral = "";
					toksSinceLastLiteral = Integer.MAX_VALUE / 10;
				} else if (SSection.isSectionNumber(token, false, true)) {
					// Want the maximal token set i.e. 2.13(a)(ii) not 2.13 or 2.13(a)
					ArrayList<TextToken> numberTokens = new ArrayList<TextToken>();
					numberTokens.add(token);
					while ((iter.hasNext())) {
						TextToken next = (TextToken) iter.peekNext();
						if (!next.toString().startsWith("("))
							break;
						if (!next.toString().endsWith(")"))
							break;
						iter.advance();
						numberTokens.add(next);
						if (next.isHasEndingSpace())
							break;
					}
					SSection match = pdfDom.fetchSection(owningSection, numberTokens, sectionLiteral);

					if (match != null) {
						Reference<SSection> ref = new Reference<SSection>(match, owningSection);
						if (sectionToken != null)
							ref.addToken(sectionToken);
						for (TextToken t : numberTokens)
							ref.addToken(t);
						match.addReferenceMention(ref);
						toksSinceLastLiteral = 0; // reset toks since last literal
					}
					sectionToken = null;
				}
			} else {
				if (SSection.isSectionLiteralReference(token) && iter.hasNext()) {
					sectionLiteral = token.toString();
					TextToken next = (TextToken) iter.peekNext();
					if (SSection.isSectionNumber(next, false, true)) {
						toksSinceLastLiteral = 0;
						sectionToken = token;
					}
				}
			}
		}
	}

	/**
	 * Search through the inputted TextBox for any definitions.
	 */
	private void extractDefinition(TextBox tbox) {
		if (tbox.getChildren().size() < 5)
			return;
		TextToken firstToken = (TextToken) tbox.getChildren().first();
		// this while loop skips over "Section" text tokens, e.g.
		while (firstToken.isInSection() || skipOverWords.contains(firstToken.toString())) {
			PhysicalComponent next = tbox.getChildren().higher(firstToken);
			if (next == null)
				break;
			firstToken = (TextToken) next;
		}
		// FIRST, if the firstToken isn't an open quote try to extract Bold or
		// Parenthetical
		boolean extractedQuoteOrBolded = false;
		if (!(firstToken.toString().equals("\"") || firstToken.toString().equals(OPEN_QUOTE))) {
			extractedQuoteOrBolded = this.extractBoldedDefinition(tbox);
			this.extractQuotedAndParentheticalDefinition(tbox);
			// TODO: extractUnderlinedDefinition(tbox);
			// SECOND, we hit this conditional if there is a quote.
		} else {
			extractedQuoteOrBolded = this.extractQuotedDefinition(tbox, firstToken);
		}
		TextToken meansPhraseStartToken = containsExplicitMeansPhrase(tbox);
		// THIRD, if we haven't extracted a quoted term, we try to extract an explicit
		// means phrase.
		if (!extractedQuoteOrBolded && meansPhraseStartToken != null) {
			this.extractExplicitMeansPhrase(tbox, firstToken, meansPhraseStartToken);
		}
	}

	public static boolean containsMeansKeyword(TextBox tbox) {
		return tbox.getText().substring(0, Math.min(tbox.getText().length(), 100)).contains("mean");
	}

	/**
	 * Searches for the occurrence of an explicit "means phrase" <- hardcoded
	 *
	 * @param tbox the input TextBox to search through
	 * @return the first TextToken occurrence of the phrase, or null if none is
	 *         found
	 */
	public static TextToken containsExplicitMeansPhrase(TextBox tbox) {
		String[] meansKeywords = { "means", "shall mean", "shall have the meaning" };
		int wordThreshold = 6;
		for (String meansKeyword : meansKeywords) {
			TextToken startToken = tbox.searchForPhraseInTokens(meansKeyword, wordThreshold);
			if (startToken != null) {
				return startToken;
			}
		}
		return null;
	}

	/**
	 * Given the start location of a means phrase, extracts the definition and body
	 * from a TextBox
	 *
	 * @param tbox             The textbox to search for the phrase
	 * @param firstToken       The start of where to search
	 * @param phraseStartToken The start of the explicit means phrase
	 */
	private void extractExplicitMeansPhrase(TextBox tbox, TextToken firstToken, TextToken phraseStartToken) {
		if (firstToken.getChildren().isEmpty() || tbox.getChildren().isEmpty()) {
			return;
		}

		Definition newDefinition = new Definition(this.pdfDom.getCurrentSection(), DefType.EXPLICIT, this.curDefId);
		newDefinition.addToDefinitionBody(tbox);
		// TODO: while the last token in the tbox is a colon...
		TextToken currToken = firstToken;
    	// get the color of the first TextChar of the firstToken to add to the definition (for DOCX)
		while (currToken != null && currToken != phraseStartToken) {
			newDefinition.addTokenToDefinitionTerm(currToken);
			currToken = (TextToken) tbox.getChildren().higher(currToken);
		}
		newDefinition.removeIfEmpty();
		this.lastWasDefinition = firstToken.equals(tbox.getChildren().first());
		this.pdfDom.currentDefinition = newDefinition;
	}

	private boolean extractQuotedDefinition(TextBox tbox, TextToken firstToken) {
		// error handling for empty definition case
		PhysicalComponent secondToken = tbox.getChildren().higher(firstToken);
		if (secondToken == null)
			return false;
		if (secondToken.toString().equals("\"") || secondToken.toString().equals(CLOSE_QUOTE)) {
			return false;
		}
		TextToken token;
		Definition newDefinition = new Definition(this.pdfDom.getCurrentSection(), DefType.EXPLICIT, this.curDefId);
		newDefinition.addToDefinitionBody(tbox);
		int currDefLength = 0;
		for (PhysicalComponent child : tbox.getChildren().tailSet(firstToken, false)) {
			if (currDefLength > MAX_DEF_SIZE) {
				newDefinition.remove();
				return false;
			}
			token = (TextToken) child;
			if (token.toString().equals("\"") || token.toString().equals(CLOSE_QUOTE)) {
				break;
			}
			newDefinition.addTokenToDefinitionTerm(token);
			currDefLength++;
		}
		newDefinition.removeIfEmpty();
		if (tbox.getChildren().isEmpty()) {
			this.lastWasDefinition = false;
		} else {
			this.lastWasDefinition = firstToken.equals(tbox.getChildren().first());
		}
		this.pdfDom.currentDefinition = newDefinition;
		// TODO Look for a second quoted term e.g. “Affiliate” or “Affiliated Persons”
		// means
		return true;
	}

	private boolean extractBoldedDefinition(TextBox tbox) {
		if (tbox.getChildren().isEmpty()) {
			return false;
		}
		TextToken firstToken = (TextToken) tbox.getChildren().first();
		while (firstToken.isInSection()) {
			PhysicalComponent next = tbox.getChildren().higher(firstToken);
			if (next == null)
				break;
			firstToken = (TextToken) next;
		}
		if ((!firstToken.isBold()) || (SSection.isSectionLiteral(firstToken))
				|| (SSection.isSectionNumber(firstToken, false, true))) {
			return false;
		}
		if (!containsMeansKeyword(tbox))
			return false;
		Definition newDefinition = new Definition(this.pdfDom.getCurrentSection(), DefType.EXPLICIT, this.curDefId);
		newDefinition.addToDefinitionBody(tbox);
		newDefinition.addTokenToDefinitionTerm(firstToken);
		if (firstToken.getChildren().isEmpty()) {
			return false;
		}
		for (PhysicalComponent child : tbox.getChildren().tailSet(firstToken, false)) {
			TextToken token = (TextToken) child;
			if (!token.isBold()) {
				break;
			}
			newDefinition.addTokenToDefinitionTerm(token);
		}
		newDefinition.removeIfEmpty();
		this.lastWasDefinition = firstToken.equals(tbox.getChildren().first());
		this.pdfDom.currentDefinition = newDefinition;
		return true;
	}

	/**
	 * Nested function to extract definitions <br>
	 * e.g. The Employment Agreement ("Agreement") shall be...
	 */
	private void extractQuotedAndParentheticalDefinition(TextBox tbox) {
    // *******************************
		// Iterate BACKWARDS over the Tbox
		// *******************************
		Iterator<PhysicalComponent> iter = tbox.getChildren().descendingIterator();
		TextToken currToken = null;
		boolean inParen = false;
		boolean inParentheticalTerm;
		int TOKENS_BEFORE_DEF = 40;
		while (iter.hasNext()) {
			currToken = (TextToken) iter.next();

			// Extract DefType.PARENTETICAL
			if (currToken.toString().equals(")")) {
				inParen = true;
				// while we are inside a parenthetical block
				while (inParen && iter.hasNext()) {
					currToken = (TextToken) iter.next();
					if (currToken.toString().equals(CLOSE_QUOTE) || currToken.toString().equals("\"")) {
						inParentheticalTerm = true;
						Definition def = new Definition(this.pdfDom.getCurrentSection(), DefType.PARENTETICAL,
								this.curDefId);
						TextToken defStartToken = currToken;
        	  			// Start with the END token color (since we are iterating backwards)
						while (inParentheticalTerm && iter.hasNext()) {
							currToken = (TextToken) iter.next();
							// if we hit an open quote while being in a term, we are done with that term -
							// finish up
							if (currToken.toString().equals(OPEN_QUOTE) || currToken.toString().equals("\"") && !currToken.getNextToken().getChildren().isEmpty()) {
              					// we are looking at the close quote so the start token is the one after
								inParentheticalTerm = false;
								addParentheticalDefinitionBody(defStartToken, def, TOKENS_BEFORE_DEF);
								if (def.getDefinitionTerm().size() < 1
										|| def.getDefinitionTerm().size() > MAX_DEF_SIZE) {
									def.remove();
								}
							} else {
								def.addTokenToDefinitionTerm(currToken);
							}
						}
						// if we never hit an open quote, def didn't finish so remove it.
						if (def.getDefinitionBodyExtracted() == null || def.getDefinitionBodyExtracted().size() == 0) {
							def.remove();
						}
						def.removeIfEmpty();
					}
					if (currToken.toString().equals("(")) {
						inParen = false;
					}
				}
			}
			// Extract DefType.QUOTED
			if (inParen == false) {
				if (currToken.toString().equals(CLOSE_QUOTE) || currToken.toString().equals("\"")) {
					boolean inNonParenQuotes = true;

					Definition def = new Definition(this.pdfDom.getCurrentSection(), DefType.QUOTED, this.curDefId);
					TextToken defStartToken = currToken;

					while (inNonParenQuotes && iter.hasNext()) {
						currToken = (TextToken) iter.next();

						if (currToken.toString().equals(OPEN_QUOTE) || currToken.toString().equals("\"") && !currToken.getNextToken().getChildren().isEmpty()) {
							// if we hit an open quote while being in a term, we are done with that term and finish up
							inNonParenQuotes = false;

							addQuotedDefinitionBody(defStartToken, def, 10, 50);
							if (def.getDefinitionTerm().size() < 1 || def.getDefinitionTerm().size() > MAX_DEF_SIZE) {
								def.remove();
							}
						} else {
							// still in the quotes: add word to definition term
							def.addTokenToDefinitionTerm(currToken);
						}
					}
					// if we never hit an open quote, def didn't finish so remove it.
					if (def.getDefinitionBodyExtracted() == null || def.getDefinitionBodyExtracted().size() == 0) {
						def.remove();
					}
					def.removeIfEmpty();
				}
			}
		}
	}

	/**
	 * Fill out the definition body of @DefType.PARENTHETICAL definitions
	 *
	 * @param defStartToken
	 * @param def
	 * @param numTokensBeforeDef
	 * @param numTokensAfterDef
	 */
	private void addParentheticalDefinitionBody(TextToken defStartToken, Definition def, int numTokensBeforeDef) {
		int count = 0;
		if (defStartToken.getNextToken().toString().equals(")")) {
			def.addTokenToExtractedBody(defStartToken.getNextToken());
		}
		while (defStartToken != null && count < numTokensBeforeDef) {
			def.addTokenToExtractedBody(defStartToken);
			defStartToken = defStartToken.getPrevToken();
			count++;
		}
	}

	/**
	 * Fill out the definition body of @DefType.QUOTED definitions
	 *
	 * @param defStartToken
	 * @param def
	 * @param numTokensBeforeDef
	 * @param numTokensAfterDef
	 */
	private void addQuotedDefinitionBody(TextToken defStartToken, Definition def, int numTokensBeforeDef,
			int numTokensAfterDef) {
		// Add context before QUOTED definition
		int count = 0;
		TextToken currentToken = defStartToken;
		while (currentToken != null && count < numTokensBeforeDef) {
			def.addTokenToExtractedBody(currentToken);
			currentToken = currentToken.getPrevToken();
			count++;
		}
		// Add context after QUOTED definition
		count = 0;
		currentToken = defStartToken;
		while (currentToken != null && count < numTokensAfterDef) {
			def.addTokenToExtractedBody(currentToken);
			currentToken = currentToken.getNextToken();
			count++;
		}
	}

	/**
	 * Create a new section or a reference to a section. Use heuristics to determine
	 * if a given 'section' literal is a reference to a section or the
	 * representative mention of the section itself.
	 *
	 */
	public void extractSection(TextBox tbox, boolean isFirstNonHeaderTextboxForPage) {
		if (tbox.getCssHeight() < this.ep.getModeCharSize() - 4) {
			return;
		}
		boolean noSubsections = (this.pdfDom.currentSection != null)
				&& (this.pdfDom.currentSection.getNumberingType() == NumberingType.UNNUMBERED);
		boolean extractNumberedSections = !this.pdfDom.isMostlyUnnumbered();
		if (this.pdfDom.currentSection.getSectionTitleString() != null) {
			if (this.pdfDom.currentSection.getSectionTitleString().toLowerCase().strip().equals("table of contents")) {
				TreeSet<TextToken> sectionTitle = this.pdfDom.currentSection.getSectionTitle();
				if (sectionTitle.isEmpty() || tbox.getPageNum() == this.pdfDom.currentSection.getSectionTitle().first().getPageNum()) {
					return;
				}
			}
		}

		if (!this.tf.isCoverPage(tbox.getPageNum(), this.ep.getNumberOfPages())) {
			//////////////////////////////////////////
			/* EXTRACTION OF ISOLATED NON-LITERALED SECTION */
			//////////////////////////////////////////
			if ((tbox.getChildren().size() < 2) && extractNumberedSections) {
				if (tbox.getChildren().size() == 1) {
					TextToken firstToken = (TextToken) tbox.getChildren().first();
					if (isFirstNonHeaderTextboxForPage && this.isOutOfTheBlue(firstToken)) {
						/* DO NOTHING */} else if (SSection.isSectionNumber(firstToken, true,
								(!lastWasDefinition) && (!noSubsections))) {
						if (!pdfDom.isDuplicateSection(null, firstToken)) {
							SSection newSection = new SSection(null, firstToken, pdfDom.currentSection, this.curSecId);
							newSection.setSectionTitle(this.extractSectionName(firstToken,
									SSection.isSubsectionLiteral(firstToken), tbox));
							this.pdfDom.addSSection(newSection);
							this.lastWasDefinition = false;
							return;
						}
					}
				}
			}
			TreeSet<PhysicalComponent> tboxChildren = tbox.getChildren();
			if (tboxChildren.isEmpty()) {
				return;
			}
			TextToken firstToken = (TextToken) tboxChildren.first();
			TextToken secondToken = (TextToken) tboxChildren.higher(firstToken);
			if (isFirstNonHeaderTextboxForPage && this.isOutOfTheBlue(firstToken)) {
				return;
			}

			// EXTRACTION OF LITERALED SECTIONS
			if (SSection.isSectionLiteral(firstToken) && SSection.isSectionNumber(secondToken, false, true)) {
				if (!isDisallowed(firstToken, secondToken)) {
					if (!pdfDom.isDuplicateSection(firstToken, secondToken)) {
						SSection newSection = new SSection(firstToken, secondToken, pdfDom.currentSection,
								this.curSecId);
						newSection.setSectionTitle(
								this.extractSectionName(secondToken, SSection.isSubsectionLiteral(secondToken), tbox));
						if (!isCodeReference(newSection.getSectionTitleString())) {
							this.pdfDom.addSSection(newSection);
							this.lastWasDefinition = false;
						}
						return;
					}
				}
			}

			// EXTRACTION OF NON-LITERALED SECTIONS
			boolean isPercent = false;
			if (secondToken != null) {
				if (secondToken.toString().trim().equals("%"))
					isPercent = true;
			}
			if ((!isPercent) && SSection.isSectionNumber(firstToken, true, (!lastWasDefinition) && (!noSubsections))
					&& extractNumberedSections) {
				if (!this.pdfDom.getCurrentSection().isPartOfAddendum()) { // don't parse numbers in addendums
					if (!pdfDom.isDuplicateSection(null, firstToken)) {
						SSection newSection = new SSection(null, firstToken, pdfDom.currentSection, this.curSecId);
						newSection.setSectionTitle(
								this.extractSectionName(firstToken, SSection.isSubsectionLiteral(firstToken), tbox));
						if (!isCodeReference(newSection.getSectionTitleString())) {
							this.pdfDom.addSSection(newSection);
							this.lastWasDefinition = false;
						}
						return;
					}
				}
			}
		}

		if (tbox.getChildren().isEmpty()) {
			return;
		}
		TextToken firstToken = (TextToken) tbox.getChildren().first();
		if (firstToken != null) {
			if (SSection.isSectionLiteralReference(firstToken)) {
				return; // Don't run unnumbered algo if numbered
			}
		}

		// EXTRACTION OF UN-NUMBERED SECTIONS
		if (!pdfDom.isDuplicateSection(tbox)) {
			if (this.tf.isCoverPage(tbox.getPageNum(), this.ep.getNumberOfPages())
					|| (!this.pdfDom.getCurrentSection().isPartOfAddendum())) {
				if (tbox.isProbablyTitle(this.ep.getModeCharSize())) {
					boolean seen = pdfDom.getCurrentSection().isDocPart()
							&& (pdfDom.getCurrentSection().getStartPage() == tbox.getPageNum());
					if (!seen) {
						SSection newSection = new SSection(null, null, pdfDom.currentSection,
								this.tf.isCoverPage(tbox.getPageNum(), this.ep.getNumberOfPages()) || this.isFirstTitle,
								this.curSecId);
						this.isFirstTitle = false;
						TreeSet<TextToken> tts = new TreeSet<TextToken>();
						for (PhysicalComponent c : tbox.getChildren()) {
							TextToken tt = (TextToken) c;
							tts.add(tt);
						}
						newSection.setSectionTitle(tts);
						if ((!"table of contents"
								.equals(this.pdfDom.getCurrentSection().getSectionTitleString().toLowerCase().trim()))
								&& (tbox.getPageNum() > 10)) {
							if ("prospectus".equals(newSection.getSectionTitleString().toLowerCase().trim())) {
								newSection.setAsDocPart();
							}
						}
						this.pdfDom.addSSection(newSection);
					}
				}
			}
		}
	}

	private boolean isOutOfTheBlue(TextToken candidateSectionLiteral) {
		if (candidateSectionLiteral != null) {
			return SSection.isAdendumLiteral(candidateSectionLiteral.toString())
					&& (candidateSectionLiteral.getPageNum() < this.ep.getNumberOfPages() / 2)
					&& (candidateSectionLiteral.getX() < 200f);
		}
		return false;
	}

	private boolean isDisallowed(TextToken first, TextToken second) {
		String t1 = first.toString().trim().toLowerCase();
		String t2 = second.toString().trim().toLowerCase();
		if (t1.equals("chapter") && t2.equals("11")) {
			return true;
		} else {
			return t1.equals(this.pdfDom.getCurrentSection().getSectionLiteralString().toLowerCase()) && t2.equals(
					this.pdfDom.getCurrentSection().getSectionNumber().toString().toLowerCase().replace(".", ""));
		}
	}

	public boolean isCodeReference(String s) {
		if ((s == null) || (s.isEmpty()))
			return false;
		String mod = s.trim().toLowerCase().replace(".", "");
		return mod.contains("us code") || mod.contains("the code") || mod.contains("bankrupcy code");
	}

	public TreeSet<TextToken> extractSectionName(TextToken lastSectionNumberToken, boolean isSubSection, TextBox tbox) {
		// if ((tbox.getChildren().size() < 15) && isSubSection) return null; // don't
		// even try on stubby subsections
		TreeSet<TextToken> pageTokens = this.ep.getAllTokensForPage(this.pageNo);
		SortedSet<TextToken> postTokens = pageTokens.tailSet(lastSectionNumberToken, false);
		Iterator<TextToken> iter = postTokens.iterator();
		TreeSet<TextToken> toret = new TreeSet<TextToken>();
		int i = 0;
		int numLower = 0;
		PDFont curFont = null;
		float prevY = -1;
		float prevX = -1;
		String prevString = "";
		while (iter.hasNext()) {
			TextToken next = iter.next();
			String nextString = next.toString();
			if (i == 0 && (nextString.equals(")") || nextString.equals("."))) {
				i++;
				continue;
			}
			PDFont nextFont = next.getFont();
			if (curFont == null) {
				curFont = nextFont;
			} else if (!curFont.equals(nextFont)) {
				return safeReturn(toret, isSubSection);
			} else if ((prevY != -1) && (Math.abs(prevY - next.getY()) > PhysicalComponent.SPACING_TOLERANCE)) {
				return safeReturn(toret, isSubSection);
			} else if ((prevX != -1) && (Math.abs(prevX - next.getX()) > 20f)) {
				return safeReturn(toret, isSubSection);
			} else if (nextString.equals(".") && (!prevString.contains("."))) {
				return toret;
			} else if (nextString.equalsIgnoreCase("etc.")) {
				toret.add(next);
				return toret;
			} else if (i >= 13) {
				return null;
			} else if (isSubSection && (next.getX() > ep.getPageWidth(pageNo) * 0.75)) {
				return null;
			} else if ((isSubSection) && (i > 4)) {
				if (numLower >= i * .75f)
					return null;
			}

			if (nextString.equals("\"") || nextString.equals(OPEN_QUOTE)) {
				return safeReturn(toret, isSubSection);
			}

			String firstChar = next.toString().substring(0, 1);
			if (firstChar.equals(firstChar.toLowerCase()))
				numLower += 1;
			toret.add(next);
			prevY = next.getY();
			prevX = next.getX() + next.getWidth();
			prevString = nextString;
			i++;
		}
		if (toret.isEmpty()) {
			return null;
		}
		if (isSubSection && toret.last().toString().equals(";")) {
			return null;
		}
		if (toret.parallelStream().mapToInt(
				a -> (!isWord(a)) || a.isTitleCase() || stopwordsSet.contains(a.toString().toLowerCase().trim()) ? 1
						: 0)
				.sum() < toret.size() * 0.8) {
			return null;
		}
		return toret;
	}

	private boolean isWord(TextToken t) {
		return t.getChildren().size() > 3;
	}

	/**
	 * Check if string only contains stopwords
	 *
	 * @return true if only stopwords
	 */
	private boolean isVacuous(TreeSet<TextToken> tts) {
		int count = tts.size();
		for (TextToken t : tts) {
			if (stopwordsSet.contains(t.toString().toLowerCase())) {
				count--;
			} else if ((t.toString().length() == 1) && (!Character.isLetter(t.toString().charAt(0)))) {
				count--;
			} else if (SSection.isSectionLiteral(t)) {
				count--;
			} else if (SSection.isSectionNumber(t, false, true)) {
				count--;
			}
		}
		return count <= 0;
	}

	private TreeSet<TextToken> safeReturn(TreeSet<TextToken> toret, boolean isSubSection) {
		if (toret.isEmpty())
			return null;
		if (isSubSection && toret.last().toString().equals(";")) {
			return null;
		}
		if (isVacuous(toret))
			return null;
		if (toret.parallelStream().mapToInt(
				a -> (!isWord(a)) || a.isTitleCase() || stopwordsSet.contains(a.toString().toLowerCase().trim()) ? 1
						: 0)
				.sum() < toret.size() * 0.8) {
			return null;
		}
		return toret;
	}

	public String getXML(TreeSet<TextBox> tboxes) throws UnsupportedEncodingException {
		StringBuilder toret = new StringBuilder();
		TextToken lastToken = (TextToken) tboxes.last().getChildren().last();
		boolean isSpecialOld = false;
		boolean isSpecialNew;
		toret.append("\n		<span>");
		for (TextBox tbox : tboxes) {
			if (TableModel.isProbablyTable(tbox)) {
				TableModel tModel = new TableModel(tbox);
				toret.append("</span>\n");
				toret.append(tModel.getTableHTMLEasyMethod());
				toret.append("\n		<span>");
				continue;
			}
			for (PhysicalComponent p : tbox.getChildren()) {
				TextToken t = (TextToken) p;
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
				toret.append(
						SafeWriter.safeStr(t.toString()) + (t.isHasEndingSpace() && (!t.equals(lastToken)) ? " " : ""));
				isSpecialOld = isSpecialNew;
			}
			toret.append("<br />");
		}
		toret.append("</span>\n");
		return toret.toString();
	}
}
