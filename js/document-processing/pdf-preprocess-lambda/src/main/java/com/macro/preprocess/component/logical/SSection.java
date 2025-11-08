package com.macro.preprocess.component.logical;

import java.io.UnsupportedEncodingException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.NavigableSet;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Pattern;

import org.apache.pdfbox.pdmodel.common.PDRectangle;

import com.google.common.primitives.Ints;
import com.macro.preprocess.component.LogicalComponent;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.parse.util.ClearNLPWrapper;
import com.macro.preprocess.parse.util.SafeWriter;
import org.apache.commons.lang3.mutable.MutableInt;
import com.macro.preprocess.component.physical.TextChar;

/**
 * LogicalComponent class for a section, subsection, subsubsection, etc.
 *
 * @author Jacob
 */
public class SSection extends LogicalComponent {

	// The following are contained by this SSection
	Set<Table> tables;
	Set<Figure> figures;
	NavigableSet<TextBox> tboxes;
	List<SSection> subsections;
	Set<Definition> definitions;
	Set<Reference<?>> references;
	// References to this section from other sections
	List<Reference<SSection>> referenceMentions;
	// Properties of this section
	SSection parentSection;
	TextToken sectionLiteral;
	TextToken sectionNumber;
	Boolean containsMoneyCached;
	Boolean containsRatioCached;
	TreeSet<TextToken> sectionTitle;
	private SubsectionLiteralType literalType;
	private NumberingType numberingType;
	public final int id;
	private short titleScore = 0;
	private boolean docPartOverride;
	public boolean showBookmark = true;
	public String bookmarkTitle = null;
	SSection owningDocPartCached;
	public static final Pattern floatPattern = Pattern.compile("[+-]?([0-9]*[.])?[0-9]+");

	/**
	 * Types of section literals that are used as a backup for section extraction
	 * when indentation tests fails
	 *
	 * @author Jacob
	 */
	private static enum SubsectionLiteralType {
		NUMERAL, // (i), (ii), (iii), (iv) etc
		ALPHA, // (a), (b), (c), (x), (y), etc
		NUMERIC, // (1), (2), (3), (10) etc
		CAPITAL_ALPHA, // (A), (B), (C), (X) etc
		OTHER,
	}

	public static enum NumberingType {
		NUMBERED, UNNUMBERED
	}

	public SSection(TextToken sectionLiteral, TextToken sectionNumber, SSection prevSection, boolean isDocPartOverride,
			MutableInt id) {
		this(sectionLiteral, sectionNumber, prevSection, id);
		this.docPartOverride = isDocPartOverride;
	}

	public SSection(TextToken sectionLiteral, TextToken sectionNumber, SSection prevSection, MutableInt id) {
		id.increment();
		id.increment();
		this.id = id.intValue();
		this.sectionLiteral = sectionLiteral;
		if (this.sectionLiteral != null)
			this.sectionLiteral.setLogicalOwner(this);
		this.sectionNumber = sectionNumber;
		if (this.sectionNumber != null)
			this.sectionNumber.setLogicalOwner(this);
		this.tables = new HashSet<Table>();
		this.figures = new HashSet<Figure>();
		this.tboxes = new TreeSet<TextBox>();
		this.subsections = new ArrayList<SSection>();
		this.definitions = new HashSet<Definition>();
		this.references = new HashSet<Reference<?>>();
		this.sectionTitle = new TreeSet<TextToken>();
		this.referenceMentions = new ArrayList<Reference<SSection>>();
		this.literalType = getSubsectionLiteralType(this.sectionNumber, prevSection);
		if (sectionNumber == null) {
			this.numberingType = NumberingType.UNNUMBERED;
		} else {
			this.numberingType = NumberingType.NUMBERED;
		}
		this.owningDocPartCached = null;
	}

  public String getSectionStartTokenHex() {
		/*
		+ "' page='" + (s.getSectionNumber() != null ? s.getSectionNumber().getPageNum()
					: s.getSectionTitle().first().getPageNum())
		 */
		// This handles the case where the section name is e.g. `1.1 Macro SAFE` -> getSectionNumber() = 1.1, which we prioritize to use as the start above the title
		TextToken startToken = this.getSectionNumber() != null ? this.getSectionNumber() : !this.getSectionTitle().isEmpty() ? this.getSectionTitle().first() : null;
		if (startToken == null) {
			return "";
		}
		return ((TextChar) startToken.getChildren().first()).hexColorCode;
	}

	public String getSectionEndTokenHex() {
		// This handles the case where the section name is e.g. `1.1(a)` WITH NO TITLE -> getSectionNumber() = 1.1(a) ;; getSectionTitle() = null
		// So we use the last token of the title if it exists, else use the last token of the number.
		// This is based on the assumption that number precedes title always
		TextToken endToken = this.getSectionTitle() != null && !this.getSectionTitle().isEmpty() ? this.getSectionTitle().last() : this.getSectionNumber();
		if (endToken == null) {
			return "";
		}
		return ((TextChar) endToken.getChildren().last()).hexColorCode;
	}

	/**
	 * Uses heuristics to determine if the given string is a section number e.g.
	 * "1", "2.2", "A3", "2.3a", "2(a)", "A.1.3". Easier to determine what is not a
	 * section number than what is.
	 */
	public static boolean isSectionNumber(TextToken token, boolean noSectionLiteral, boolean acceptSubsections) {
		if (token == null)
			return false;
		/*
		 * long wordToNum = ClearNLPWrapper.wordsToNum(token.toString()); if (wordToNum
		 * > 0) { // parseable if (wordToNum < 1e4) return true; } else if
		 * (token.getChildren().size() > 9) return false; // not a wordnum
		 */ // removed to increase precision

		String string = token.toString();
		if (string == null)
			return false;
		String candidate = string.trim();
		if (string.endsWith(".")) {
			string = string.substring(0, string.length() - 1);
		}
		if (candidate.equals("a"))
			return false;
		Integer intVal;
		if ((intVal = Ints.tryParse(candidate)) != null) {
			if (intVal > 99) {
				return false;
			}
		}
		if (noSectionLiteral) { // tougher restrictions if not proceeded by a section literal
			if (!(candidate.contains(".") || candidate.contains(")")))
				return false;
			if (token.getX() > 300f)
				return false;
			if (candidate.equals("1.00") || candidate.toLowerCase().equals("a") || candidate.toLowerCase().equals("i"))
				return false;

			// Reject things like U.S.A or J.P.
			String[] periodSplit = string.trim().split("\\.");
			if (periodSplit.length >= 1) {
				boolean allAlpha = Arrays.asList(periodSplit).parallelStream()
						.map(a -> ((a.length() == 1) && Character.isAlphabetic(a.charAt(0))) || a.isEmpty())
						.reduce(true, (cum, elm) -> cum && elm);
				if (allAlpha)
					return false;
			}
			String isolated = getIsolatedSubsectionLiteral(candidate);
		} else {
			if (floatPattern.matcher(candidate).matches()) {
				return true;
			}
		}
		candidate = string.trim();

		if (!acceptSubsections) {
			if (isSubsectionLiteral(token))
				return false;
		}

		if (candidate.length() >= 8)
			return false;
		if (candidate.length() == 0)
			return false;
		if (candidate.length() == 1) {
			if (!Character.isLetterOrDigit(candidate.charAt(0)))
				return false;
			return true;
		} else {
			boolean isChar = false;
			for (char c : candidate.toCharArray()) {
				if (Character.isLetter(c) && (Character.toLowerCase(c) != 'x') && (Character.toLowerCase(c) != 'i')
						&& (Character.toLowerCase(c) != 'v')) {
					if (isChar)
						return false;
					isChar = true;
				} else {
					isChar = false;
				}
			}
		}
		if (candidate.toLowerCase().equals("is") || candidate.toLowerCase().equals("in")
				|| candidate.toLowerCase().equals("if"))
			return false;
		if (candidate.charAt(0) == '’' || candidate.charAt(0) == '-')
			return false;
		return true;
	}

	/**
	 * Pseudo-comparator between two section numbers
	 *
	 * @param s1
	 * @param s2
	 * @return true if s1 is numerically before s2
	 */
	public static boolean compareNumbers(SSection s1, TextToken candidateSectionLiteral, TextToken n2) {
		if (s1.getSectionNumber() == null)
			return true;
		TextToken n1 = s1.getSectionNumber();
		if (isSubsectionLiteral(n2))
			return true; // return true for all subsections, could improve this
		if (s1.isSuperSectionOf(candidateSectionLiteral, n2))
			return true;

		String str1 = n1.toString().endsWith(".") ? n1.toString().substring(n1.toString().length() - 1) : n1.toString();
		String str2 = n2.toString().endsWith(".") ? n2.toString().substring(n2.toString().length() - 1) : n2.toString();

		if ((str1.length() == 1) && (str2.length() == 1)) {
			char c1 = str1.charAt(0);
			char c2 = str2.charAt(0);
			if (Character.isAlphabetic(c1) && Character.isAlphabetic(c2)) {
				return c1 < c2;
			} else {
				return true;
			}
		}

		StringBuilder num1S = new StringBuilder();
		StringBuilder num2S = new StringBuilder();
		boolean seenPoint1 = false;
		for (Character c : str1.toCharArray()) {
			if ((c == '.') && seenPoint1)
				continue;
			if ((c == '.'))
				seenPoint1 = true;
			if (Character.isDigit(c) || c == '.')
				num1S.append(c);
		}
		boolean seenPoint2 = false;
		for (Character c : str2.toCharArray()) {
			if ((c == '.') && seenPoint2)
				continue;
			if ((c == '.'))
				seenPoint2 = true;
			if (Character.isDigit(c) || c == '.')
				num2S.append(c);
		}
		if (num1S.toString().equals("."))
			return false;
		if (num2S.toString().equals("."))
			return false;
		float num1;
		float num2;

		if ((num1S.toString().length() != 0) && (num2S.toString().length() != 0)) {
			int a1 = Integer.parseInt(num1S.toString().replace(".", ""));
			int a2 = Integer.parseInt(num2S.toString().replace(".", ""));
			return a1 < a2;
		}

		if (num1S.toString().length() != 0) {
			num1 = Float.parseFloat(num1S.toString());
		} else {
			num1 = toArabic(str1.toUpperCase());
		}

		if (num2S.toString().length() != 0) {
			num2 = Float.parseFloat(num2S.toString());
		} else {
			num2 = toArabic(str2.toUpperCase());
		}

		if ((num1 < 0) || (num2 < 0))
			return true;

		return num1 <= num2 + .9f; // build in tolerance for missed section or two
	}

	public static int toArabic(String number) {
		if (number.isEmpty())
			return 0;
		if (number.startsWith("M"))
			return 1000 + toArabic(number.substring(1));
		if (number.startsWith("CM"))
			return 900 + toArabic(number.substring(2));
		if (number.startsWith("D"))
			return 500 + toArabic(number.substring(1));
		if (number.startsWith("CD"))
			return 400 + toArabic(number.substring(2));
		if (number.startsWith("C"))
			return 100 + toArabic(number.substring(1));
		if (number.startsWith("XC"))
			return 90 + toArabic(number.substring(2));
		if (number.startsWith("L"))
			return 50 + toArabic(number.substring(1));
		if (number.startsWith("XL"))
			return 40 + toArabic(number.substring(2));
		if (number.startsWith("X"))
			return 10 + toArabic(number.substring(1));
		if (number.startsWith("IX"))
			return 9 + toArabic(number.substring(2));
		if (number.startsWith("V"))
			return 5 + toArabic(number.substring(1));
		if (number.startsWith("IV"))
			return 4 + toArabic(number.substring(2));
		if (number.startsWith("I"))
			return 1 + toArabic(number.substring(1));
		return Integer.MIN_VALUE / 10;
	}

	/**
	 * Check if this literal is a subsection e.g. (a), (b), (c), (aa), (i), (iv)
	 *
	 * @param s1
	 * @return true if is a subsection literal
	 */
	public static boolean isSubsectionLiteral(TextToken s1) {
		if ((s1 == null) || (s1.toString().length() == 0))
			return false;
		String string = s1.toString();
		String candidate = string.trim();
		if (candidate.charAt(candidate.length() - 1) == ')')
			return true;
		if ((candidate.charAt(candidate.length() - 1) == '.')) {
			if ((candidate.length() > 2) && (Character.isLetter(candidate.charAt(candidate.length() - 2)))) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Uses heuristics to determine if the given string is a section literal.
	 */
	public static boolean isSectionLiteral(TextToken t) {
		String string = t.toString();

		if ((string == null) || (string.isEmpty())) {
			return false;
		}
		if (!t.isTitleCase()) {
			return false;
		}
		String candidate = string.trim().toLowerCase();
		// TODO use regex
		if (candidate.contains("section") || candidate.contains("article") || candidate.contains("clause")
				|| candidate.contains("paragraph") || candidate.equals("part") || candidate.equals("item")
				|| candidate.equals("chapter")) {
			return true;
		}
		if (candidate.equals("exhibit") || candidate.equals("schedule") || candidate.equals("annex")
				|| candidate.equals("attachment")) {
			if (t.getPageNum() == 0) {
				return false;
		  }
			if (t.getParent().isTitleCached()) {
				return true;
			}
			int totalPages = t.getDocument().getNumberOfPages();
			if (t.getPageNum() > totalPages * 0.8) {
				return true;
			}
			if (t.getParent().isCentered() && t.getParent().wordDistanceTest()
					|| t.getX() > t.getDocument().getPage(t.getPageNum()).getBBox().getWidth() * 0.5) {
				return true;
			}
		}
		return false;
	}

	public static boolean isAdendumLiteral(String t) {
		String candidate = t.toLowerCase().trim();
		return (candidate.equals("exhibit") || candidate.equals("schedule") || candidate.equals("annex")
				|| candidate.equals("attachment"));
	}

	/**
	 * Uses heuristics to determine if the given string is a section literal. More
	 * generous than the general parsing algo above
	 */
	public static boolean isSectionLiteralReference(TextToken t) {
		String string = t.toString();
		if (string == null)
			return false;
		String candidate = string.trim().toLowerCase();
		if (candidate.contains("section") || candidate.contains("article") || candidate.contains("clause")
				|| candidate.contains("paragraph") || candidate.equals("part") || candidate.equals("item")
				|| candidate.equals("chapter") || candidate.equals("exhibit") || candidate.equals("schedule")
				|| candidate.equals("attachment") || candidate.equals("annex"))
			return true;
		return false;
	}

	public boolean isSuperSectionOf(SSection other) {
		if (other.isDocPart())
			return false;
		if ((other.getSectionNumber() != null) && (!other.getSectionNumber().toString().equals(""))) {
			return this.isSuperSectionOf(other.sectionLiteral, other.sectionNumber);
		}
		return this.isSuperSectionOf(other.sectionTitle);
	}

	/**
	 * Will be called on prospective unnumbered sections
	 *
	 * @param sectionTitle the prospective new section title
	 * @return true if this super section is a
	 */
	public boolean isSuperSectionOf(TreeSet<TextToken> title) {
		if (this.isDocPart()) {
			return true;
		}
		if (title.isEmpty())
			return false;
		if (this.numberingType == NumberingType.NUMBERED) {
			if (TextBox.isCentered(title.first(), title.last())) {
				if (this.sectionLiteral == null || this.sectionLiteral.toString().isEmpty()) {
					if (this.getSectionNumber().getX() < this.getSectionNumber().getDocument()
							.getPage(this.getSectionNumber().getPageNum()).getBBox().getWidth() / 3) {
						return false;
					}
				}
			}
			return true;
		} else if (this.numberingType == NumberingType.UNNUMBERED) {
			if (this.getSectionTitle().first().getParent().isCentered()) { // this centered, that not centered
				if (!TextBox.isCentered(title.first(), title.last())) {
					return true;
				} else { // compare based on score
					TextBox thisBox = this.getSectionTitle().first().getParent();
					TextBox otherBox = title.first().getParent();
					// 0: if this is bigger than child by a lot, parent
					if (thisBox.getCssHeight() > otherBox.getCssHeight() + 2)
						return true;
					// 1: if this is all caps, and child is not, parent
					if (thisBox.isAllUppercase() && (!otherBox.isAllUppercase()))
						return true;
					// 2: if this is not italic, and child is italic, parent
					if ((!thisBox.isAllItalic()) && otherBox.isAllItalic())
						return true;
					// 3: if this is bold, and child is not, parent
					if (thisBox.isAllBold() && (!otherBox.isAllBold()))
						return true;
				}
			} else {
				if (!TextBox.isCentered(title.first(), title.last())) { // i.e. both are not centered
					if (this.getSectionTitle().first().getX() - title.first().getX() < -5f) {
						return true;
					}
				}
			}
		}
		return false;
	}

	/**
	 * @param SSection of interest
	 * @return true if the SSection should be a subsection of this section based on
	 *         its section number. Assumption of this code architecture is that we
	 *         will encounter sections before subsecitons which seems like a pretty
	 *         safe assumption by definition.
	 */
	public boolean isSuperSectionOf(TextToken candidateSectionLiteral, TextToken ss) {
		if (candidateSectionLiteral != null) {
			String candidate = candidateSectionLiteral.toString().toLowerCase().trim();
			if (candidate.equals("exhibit")) {
				return false;
			}
			if (candidate.equals("schedule") || candidate.equals("annex") || candidate.equals("attachment")) {
				if (!this.isDocPart()) {
					return false;
				}

			}
		}

		if ((SSection.isSubsectionLiteral(this.getSectionLiteral()))
				&& (!SSection.isSubsectionLiteral(candidateSectionLiteral))) {
			return false;
		}

		if (this.isDocPart())
			return true;
		// An unnumbered is only parent of a numbered if it is a DocPart (above) or the
		// following:
		if (this.numberingType == NumberingType.UNNUMBERED) {
			if (this.getSectionTitle().isEmpty())
				return false;
			if (TextBox.isCentered(this.getSectionTitle().first(), this.getSectionTitle().last())) {
				if (candidateSectionLiteral == null || candidateSectionLiteral.toString().isEmpty()) {
					if (this.getSectionTitleString().toLowerCase().trim().contains("recital"))
						return false;
					if (ss.getX() < ss.getDocument().getPage(ss.getPageNum()).getBBox().getWidth() / 3) {
						return true;
					}
				}
			}
			return false;
		}
		// if (this.sectionNumber == null) return false;

		// Some section literals take precendence
		if (this.getSectionLiteralString().toLowerCase().equals("article")) {
			if ((candidateSectionLiteral == null)
					|| (!candidateSectionLiteral.toString().toLowerCase().equals("article"))) {
				return true;
			}
		}
		if (this.getSectionLiteralString().toLowerCase().equals("schedule")) {
			if ((candidateSectionLiteral == null)
					|| (candidateSectionLiteral.toString().toLowerCase().equals("part"))) {
				return true;
			}
		}
		if (this.getSectionLiteralString().toLowerCase().equals("annex")) {
			if (candidateSectionLiteral == null) {
				return true;
			}
		}
		// For 10-Ks
		if (this.getSectionLiteralString().toLowerCase().equals("part")) {
			if ((candidateSectionLiteral == null)
					|| (!candidateSectionLiteral.toString().toLowerCase().equals("part"))) {
				return true;
			}
		}
		if (this.getSectionLiteralString().toLowerCase().equals("item")) {
			if ((candidateSectionLiteral == null)
					|| (!candidateSectionLiteral.toString().toLowerCase().equals("item"))) {
				if ((candidateSectionLiteral == null)
						|| (!candidateSectionLiteral.toString().toLowerCase().equals("part"))) {
					return true;
				}
			}
		}

		if (isSuperSectionLayoutBased(candidateSectionLiteral, ss))
			return true;
		if (isSubsectionLiteral(this.getSectionNumber())) {
			if (ss.getX() < this.getSectionNumber().getX() - 20f)
				return false;
			// Use position tests before relying on isSubsection heuristics
			if (!isSubsectionLiteral(ss))
				return false;

			if (this.literalType.equals(SSection.getSubsectionLiteralType(ss, this)))
				return false;
			SubsectionLiteralType parentType = this.getParentSection() == null ? null
					: this.getParentSection().literalType;
			if ((parentType != null) && (SSection.getSubsectionLiteralType(ss, this).equals(parentType)))
				return false;

			// LEGACY CODE AS BACKUP
			// Numerals should be a subsection of letters
			int numeralThisParsed = SSection
					.toArabic(this.getSectionNumber().toString().replace("(", "").replace(")", "").toUpperCase());
			int numeralSSParsed = SSection.toArabic(ss.toString().replace("(", "").replace(")", "").toUpperCase());
			if ((((numeralThisParsed < 0) && (!(this.sectionNumber.toString().toLowerCase().equals("(h)"))))
					|| (numeralThisParsed > 30)) && (numeralSSParsed > 0) && (numeralSSParsed < 30))
				return true;
			// Change of capitalization also indicates subsection not sibling
			if (isSubsectionLiteral(ss)) {
				String thisNoBrac = this.getSectionNumber().toString().replace("(", "").replace(")", "");
				String ssNoBrac = ss.toString().replace("(", "").replace(")", "");
				boolean thisIsLower = thisNoBrac.toLowerCase().equals(thisNoBrac);
				boolean ssIsLower = ssNoBrac.toLowerCase().equals(ssNoBrac);
				if ((thisIsLower == true) && (ssIsLower == false))
					return true;
			}
			return false;
			// END LEGACY CODE
		}
		if (isSubsectionLiteral(ss))
			return true;
		int numeralThis = SSection.toArabic(this.sectionNumber.toString().toUpperCase());
		int numeralSS = SSection.toArabic(ss.toString().toUpperCase());
		if ((numeralSS > 0) && (numeralThis > 0))
			return false;
		if (numeralThis > 0) {
			String num = "";
			for (Character c : ss.toString().toCharArray()) {
				if (Character.isDigit(c))
					num += c;
				else
					break;
			}
			if (num.length() == 0)
				return false;
			return numeralThis == Integer.parseInt(num);
		}
		String tString = this.sectionNumber.toString();
		String oString = ss.toString();
		if (tString.length() > oString.length())
			return false;
		for (int i = 0; i < tString.length(); i++) {
			if (tString.charAt(i) != oString.charAt(i))
				return false;
		}
		return tString.length() < oString.length();
	}

	private boolean isSuperSectionLayoutBased(TextToken candidateSectionLiteral, TextToken ss) {
		if ((this.sectionLiteral == null) && (candidateSectionLiteral != null)) {
			return false;
		}
		if (this.sectionNumber != null) {
			PDRectangle bbox = this.sectionNumber.getDocument().getPage(this.sectionNumber.getPageNum()).getBBox();
			float width = bbox.getWidth();
			float height = bbox.getHeight();
			if (this.sectionNumber.getY() > .07f * height) {
				if ((this.sectionNumber.getX() < width * .25f) && (ss.getX() < width * .25f)) {
					if ((candidateSectionLiteral != null)
							&& ((candidateSectionLiteral.toString().toLowerCase().equals("article")
									|| candidateSectionLiteral.toString().toLowerCase().equals("schedule")
									|| candidateSectionLiteral.toString().toLowerCase().equals("annex")))) {
						return false;
					}
					if (ss.getX() > this.sectionNumber.getX() + 15f) {
						return true;
					}
				}
			}
		}
		return false;
	}

	/**
	 * Gets the name that would be referenced by, e.g. the literal might be (ii) but
	 * the fully qualified section is 5.11(a)(ii) if (ii) is a subsection of (a) is
	 * a subsection of 5.11
	 *
	 * @return the fully qualified section number
	 */
	public String getFullyQualifiedSectionNumber() {
		if (this.getSectionNumber() == null)
			return "";
		if (!isSubsectionLiteral(this.getSectionNumber())) {
			String properSection = this.getSectionNumber().toString();
			String properSectionNoPeriod = properSection.endsWith(".")
					? properSection.substring(0, properSection.length() - 1)
					: properSection;
			return properSectionNoPeriod;
		}
		SSection curSection = this;
		StringBuilder toret = new StringBuilder();
		// ALL ALL SUBSECTIONS
		if (SSection.isSubsectionLiteral(this.getSectionNumber())) {
			do {
				toret.insert(0, curSection.getSectionNumber().toString());
				curSection = curSection.getParentSection();
			} while ((curSection != null) && (curSection.getSectionNumber() != null)
					&& (SSection.isSubsectionLiteral(curSection.getSectionNumber())));
		}
		// ADD NUMBERED SECTION
		if ((curSection != null) && (curSection.getSectionNumber() != null)) {
			String properSection = curSection.getSectionNumber().toString();
			String properSectionNoPeriod = properSection.endsWith(".")
					? properSection.substring(0, properSection.length() - 1)
					: properSection;
			toret.insert(0, properSectionNoPeriod);
		}

		return toret.toString();
	}

	/**
	 *
	 * @param s
	 * @return true if s is a literal reference to this SSection
	 */
	public boolean matches(TextToken literal, TextToken number) {
		if (literal != null) {
			if (!literal.toString().equals(this.getSectionLiteralString()))
				return false;
		}
		if ((literal == null) && (this.getSectionLiteral() != null))
			return false;
		String s = number.toString();
		String qualified = this.getFullyQualifiedSectionNumber();

		String sMod = s.endsWith(".") ? s.substring(0, s.length() - 1) : s;
		sMod = sMod.endsWith(".0") ? sMod.substring(0, sMod.length() - 2) : sMod;

		String qualifiedMod = qualified.endsWith(".") ? qualified.substring(0, qualified.length() - 1) : qualified;
		qualifiedMod = qualifiedMod.endsWith(".0") ? qualifiedMod.substring(0, qualifiedMod.length() - 2) : qualifiedMod;

		return qualifiedMod.equals(sMod);
	}

	public boolean matches(String literal, TextToken number) {
		if (literal != null) {
			if (!literal.equals(this.getSectionLiteralString()))
				return false;
		}
		if ((literal == null) && (this.getSectionLiteral() != null))
			return false;
		String s = number.toString();
		String qualified = this.getFullyQualifiedSectionNumber();

		String sMod = s.endsWith(".") ? s.substring(0, s.length() - 1) : s;
		sMod = sMod.endsWith(".0") ? sMod.substring(0, sMod.length() - 2) : sMod;

		String qualifiedMod = qualified.endsWith(".") ? qualified.substring(0, qualified.length() - 1) : qualified;
		qualifiedMod = qualifiedMod.endsWith(".0") ? qualifiedMod.substring(0, qualifiedMod.length() - 2) : qualifiedMod;

		return qualifiedMod.equals(sMod);
	}


	public boolean partialMatches(ArrayList<TextToken> parts, String sectionLiteral) {
		if (!this.sectionLiteralMatchesThis(sectionLiteral))
			return false;
		if ((this.getSectionNumber() != null) && (parts.get(0).toString().replace(".0", "").equals(this.getSectionNumber().toString().replace(".0", "")))) {
			return true;
		}
		// not an exact match; perhaps it is a partial match
		SSection currentSection = this;
		ArrayList<TextToken> newParts = (ArrayList<TextToken>) parts.clone();
		Collections.reverse(newParts);
		for (TextToken part : newParts) {
			if (currentSection == null)
				return false;
			if (currentSection.getSectionNumber() == null)
				return false;
			String currentSectionPlain = getIsolatedSubsectionLiteral(currentSection.getSectionNumber().toString());
			String partPlain = getIsolatedSubsectionLiteral(part.toString());
			if (!partPlain.equals(currentSectionPlain))
				return false;
			currentSection = currentSection.getParentSection();
		}
		return true;
	}

	public String getCssName() {
		return this.getSectionLiteralString().toLowerCase() + "_" + this.sectionNumber.toString().toLowerCase();
	}

	private static SubsectionLiteralType getSubsectionLiteralType(TextToken t, SSection prevSection) {
		if ((t == null) || (t.toString().isEmpty()))
			return SubsectionLiteralType.OTHER;
		String literal = getIsolatedSubsectionLiteral(t.toString());
		// SPECIAL CASES
		if (!prevSection.literalType.equals(SubsectionLiteralType.OTHER)) {
			String prevLiteral = getIsolatedSubsectionLiteral(prevSection.getSectionNumber().toString());
			if ((prevLiteral.equals("u")) && (literal.equals("v"))) {
				return SubsectionLiteralType.ALPHA;
			} else if ((prevLiteral.equals("w")) && (literal.equals("x"))) {
				return SubsectionLiteralType.ALPHA;
			} else if ((prevLiteral.equals("h")) && (literal.equals("i"))) {
				return SubsectionLiteralType.ALPHA;
			}
		}
		// GENERAL CASES
		if (!SSection.isSubsectionLiteral(t)) {
			return SubsectionLiteralType.OTHER;
		}
		int numeralThisParsed = SSection.toArabic(literal.toUpperCase());
		if ((numeralThisParsed > 0) && (numeralThisParsed < 30))
			return SubsectionLiteralType.NUMERAL;
		try {
			Float.parseFloat(literal);
			return SubsectionLiteralType.NUMERIC;
		} catch (Exception e) {
		}
		if (literal.toUpperCase().equals(literal))
			return SubsectionLiteralType.CAPITAL_ALPHA;
		return SubsectionLiteralType.ALPHA;
	}

	/**
	 * e.g. (a) --> a <br>
	 * e.g. a. --> a <br>
	 * e.g. (iv) --> iv
	 */
	private static String getIsolatedSubsectionLiteral(String literal) {
		String secNumber = literal.replace(")", "").replace("(", "");
		secNumber = (secNumber.endsWith(".")) ? secNumber.substring(0, secNumber.length() - 1) : secNumber;
		return secNumber;
	}

	@Override
	public SSection getSection() {
		return this;
	}

	public SSection getParentSection() {
		return this.parentSection;
	}

	@Override
	public void setSection(SSection section) {
		this.parentSection = section;
	}

	public Set<Table> getTables() {
		return tables;
	}

	public boolean isSubsectionLiteral() {
		return this.literalType.equals(SubsectionLiteralType.OTHER);
	}

	public void addTable(Table e) {
		this.tables.add(e);
	}

	public Set<Figure> getFigures() {
		return figures;
	}

	public void addFigure(Figure e) {
		this.figures.add(e);
	}

	public NavigableSet<TextBox> getTboxes() {
		return this.tboxes;
	}

	public void addTbox(TextBox e) {
		e.setLogicalOwner(this);
		this.tboxes.add(e);
	}

	public List<SSection> getSubsections() {
		return subsections;
	}

	public void addSubsection(SSection e) {
		e.parentSection = this;
		this.subsections.add(e);
	}

	public Set<Definition> getDefinitions() {
		return definitions;
	}

	public void addDefinition(Definition e) {
		this.definitions.add(e);
	}

	public void removeDefinition(Definition e) {
		this.definitions.remove(e);
	}

	public Set<Reference<?>> getReferences() {
		return references;
	}

	public void addReference(Reference<?> e) {
		this.references.add(e);
	}

	public List<Reference<SSection>> getReferenceMentions() {
		return referenceMentions;
	}

	public void addReferenceMention(Reference<SSection> e) {
		this.referenceMentions.add(e);
	}

	public TextToken getSectionLiteral() {
		return sectionLiteral;
	}

	public TextToken getSectionNumber() {
		return sectionNumber;
	}

	public String getSectionLiteralString() {
		if (this.sectionLiteral != null) {
			return this.getSectionLiteral().toString();
		}
		if (this.numberingType == NumberingType.UNNUMBERED)
			return "";
		return "section";
	}

	public void setSectionLiteral(TextToken sectionLiteral) {
		this.sectionLiteral = sectionLiteral;
	}

	public void setSectionTitle(TreeSet<TextToken> title) {
		if (title == null)
			return;
		for (TextToken t : title) {
			t.setLogicalOwner(this);
			this.titleScore = t.getParent().getTitleScore();
		}
		this.sectionTitle = title;
	}

	public TreeSet<TextToken> getSectionTitle() {
		return this.sectionTitle;
	}

	public String getSectionTitleString() {
		if (this.sectionTitle == null)
			return null;
		StringBuilder sb = new StringBuilder();
		for (TextToken t : this.getSectionTitle()) {
			sb.append(t.toString());
			if (t.isHasEndingSpace())
				sb.append(" ");
		}
		return sb.toString();
	}

	public String getText() {
		StringBuilder sb = new StringBuilder();
		for (TextBox t : this.tboxes) {
			sb.append(t.getText() + "\n");
		}
		return sb.toString();
	}

	public String getXML() {
		try {
			return SafeWriter.getXML(this.getTboxes());
		} catch (UnsupportedEncodingException e) {
			e.printStackTrace();
			return "";
		}
	}

	/**
	 * Return the text of all subsections that have NER MONEY in them
	 *
	 * @return
	 */
	public String getAllSubsectionNumericXML() {
		StringBuilder s = new StringBuilder();
		getAllSubsectionNumericXMLRec(this, s);
		return s.toString();
	}

	public void getAllSubsectionNumericXMLRec(SSection currentSection, StringBuilder s) {
		if (currentSection.containsMoney() || currentSection.containsRatioLiteral()) {
			s.append(currentSection.getXML());
		}
		for (SSection subsec : currentSection.getSubsections()) {
			getAllSubsectionNumericXMLRec(subsec, s);
		}
	}

	/**
	 * @return true if this section's text or any of its subsections contains Money
	 *         as recognized by the Named Entity Recognizer
	 */
	public boolean containsMoney() {
		if (this.containsMoneyCached != null)
			return this.containsMoneyCached;
		if (ClearNLPWrapper.containsMoney(this.getText())) {
			this.containsMoneyCached = true;
			return true;
		}
		if (!this.literalType.equals(SubsectionLiteralType.OTHER)) { // is subsection literal
			for (SSection s : this.getSubsections()) {
				if (ClearNLPWrapper.containsRatioLiteral(s)) {
					s.containsRatioCached = true;
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * @return true if this section's text or any of its subsections contains Money
	 *         as recognized by the Named Entity Recognizer
	 */
	public boolean containsRatioLiteral() {
		if (this.containsRatioCached != null)
			return this.containsRatioCached;
		if (ClearNLPWrapper.containsRatioLiteral(this)) {
			this.containsRatioCached = true;
			return true;
		}
		if (!this.literalType.equals(SubsectionLiteralType.OTHER)) { // is subsection literal
			for (SSection s : this.getSubsections()) {
				if (ClearNLPWrapper.containsRatioLiteral(s)) {
					s.containsRatioCached = true;
					return true;
				}
			}
		}
		return false;
	}

	public NumberingType getNumberingType() {
		return this.numberingType;
	}

	public boolean isDocPart() {
		// no nested docparts
		if (this.docPartOverride)
			return true;
		if (this.getParentSection() != null && this.getParentSection().isDocPart())
			return false;
		if (this.getSectionLiteralString() != null && !this.getSectionLiteralString().isEmpty()) {
			String candidate = this.getSectionLiteralString().trim().toLowerCase();
			if (candidate.equals("exhibit"))
				return true;
		}
		if (this.getSectionTitle() == null || this.getSectionTitle().isEmpty()) {
			return false;
		}
		return false;
	}

	/**
	 * Does the given section literal - likely a prospective section reference match
	 * this section literal?
	 *
	 * @return true if the sectionLiteral matches this section literal
	 */
	public boolean sectionLiteralMatchesThis(String sectionLiteral) {
		if (sectionLiteral == null)
			return true;
		String thisSectionLiteral = this.getSectionLiteralString().toLowerCase().trim();
		String otherSectionLiteral = sectionLiteral.toLowerCase().trim();
		if (otherSectionLiteral.isEmpty())
			return true;

		if (thisSectionLiteral.equals(otherSectionLiteral))
			return true;
		if (thisSectionLiteral.contains(otherSectionLiteral))
			return true;
		if (otherSectionLiteral.contains(thisSectionLiteral))
			return true;

		if (thisSectionLiteral.contains("section")) { // popular synonym
			if (otherSectionLiteral.contains("clause") || otherSectionLiteral.contains("paragraph"))
				return true;
		}
		return false;
	}

	/**
	 * Get the owning doc part for a given SSection
	 *
	 * @param s SSection
	 * @return owning doc part
	 */
	public static SSection getOwningDocPart(SSection s) {
		if (s == null)
			return null;
		if (s.isDocPart())
			return s;
		return getOwningDocPart(s.parentSection);
	}

	/**
	 * Get the owning doc part for this section
	 *
	 * @return
	 */
	public SSection getOwningDocPart() {
		if (this.owningDocPartCached != null)
			return this.owningDocPartCached;
		this.owningDocPartCached = SSection.getOwningDocPart(this);
		return this.owningDocPartCached;
	}

	/**
	 * Is this section part of an exhibit, schedule, or annex?
	 *
	 * @return
	 */
	public boolean isPartOfAddendum() {
		if (this.getSectionLiteralString() != null) {
			String lit = this.getSectionLiteralString().trim().toLowerCase();
			if (lit.equals("exhibit") || lit.equals("schedule") || lit.equals("annex")) {
				String sectionNumber = this.getSectionNumber() != null ? this.getSectionNumber().toString() : "";
				if (sectionNumber.startsWith("10"))
					return false; // SEC filings all do 10.blah
				else
					return true;
			}
		}
		if (this.getParentSection() == null)
			return false;
		return this.getParentSection().isPartOfAddendum();
	}

	public int getStartPage() {
		if (this.getSectionLiteral() != null) {
			return this.getSectionLiteral().getPageNum();
		}
		if (this.getSectionNumber() != null) {
			return this.getSectionNumber().getPageNum();
		}
		if ((this.getSectionTitle() != null) && (!this.getSectionTitle().isEmpty())) {
			return this.getSectionTitle().first().getPageNum();
		}
		return 0;
	}

	public void setAsDocPart() {
		this.docPartOverride = true;
	}
}
