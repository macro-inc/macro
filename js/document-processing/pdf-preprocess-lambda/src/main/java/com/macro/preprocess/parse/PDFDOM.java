package com.macro.preprocess.parse;

import java.io.FileNotFoundException;
import java.io.Serializable;
import java.io.StringWriter;
import java.io.UnsupportedEncodingException;
import java.io.Writer;
import java.util.ArrayList;
import java.util.Collection;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import org.apache.commons.lang3.mutable.MutableInt;
import com.macro.preprocess.component.logical.Definition;
import com.macro.preprocess.component.logical.Definition.DefType;
import com.macro.preprocess.component.logical.Reference;
import com.macro.preprocess.component.logical.SSection;
import com.macro.preprocess.component.logical.SSection.NumberingType;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.parse.AnomalyDetector.AnomalyType;
import com.macro.preprocess.parse.util.SafeWriter;

/**
 * Wrapper class for the DOM tree providing construction, storage, and
 * navigation.
 *
 * @author Jacob
 *
 */
public class PDFDOM implements Serializable {

	private static final long serialVersionUID = 1L;
	SSection preamble;
	List<SSection> topLevelSections;
	List<SSection> allSections;
	SSection currentSection;
	Definition currentDefinition;
	public boolean readOnly;
	private Set<Integer> tocPages;
	public float quantityNumberedSections = 0f;
	public float quantityUnnumberedSections = 0f;
	AnomalyDetector ad;

	public PDFDOM(AnomalyDetector ad) {
		this.preamble = new SSection(null, null, null, new MutableInt(-10));
		this.topLevelSections = new ArrayList<SSection>();
		this.allSections = new ArrayList<SSection>();
		this.currentSection = this.preamble;
		this.tocPages = new HashSet<Integer>();
		this.ad = ad;
	}

	public List<SSection> getTopLevelSections() {
		return this.topLevelSections;
	}

	public void addTocPage(int pageId) {
		this.tocPages.add(pageId);
	}

	public boolean isTocPage(int pageId) {
		return tocPages.contains(pageId);
	}

	public void addSSection(SSection ss) {
		/*
		 * String toPrint = ""; if (ss.getSectionNumber() != null) { toPrint +=
		 * ss.getSectionLiteralString() + " " + ss.getFullyQualifiedSectionNumber(); }
		 * else { toPrint += ss.getSectionTitleString(); }
		 */
		// System.out.println(toPrint);
		SSection secToBeParent = null;
		secToBeParent = getCandidateParent(ss);
		if (secToBeParent != null)
			secToBeParent.addSubsection(ss);
		else
			this.topLevelSections.add(ss);
		this.currentSection = ss;
		this.allSections.add(ss);
		if (ss.getNumberingType() == NumberingType.NUMBERED)
			quantityNumberedSections++;
		else
			quantityUnnumberedSections++;
	}

	public List<SSection> getAllSections() {
		return this.allSections;
	}

	/**
	 * Get the section that would be the parent of this candidate section number, if
	 * it were to be added. This method is used to determine if a duplicate section
	 * exists and to add the section.
	 *
	 * @param candidateSectionLiteral the extracted section literal e.g.
	 *                                "article"/"section"
	 * @param sectionNumber           the extracted section number
	 * @return
	 */
	private SSection getCandidateParent(TextToken candidateSectionLiteral, TextToken sectionNumber) {
		SSection secToBeParent = this.getCurrentSection();
		while ((secToBeParent != null) && (!secToBeParent.isSuperSectionOf(candidateSectionLiteral, sectionNumber))) {
			secToBeParent = secToBeParent.getParentSection();
		}
		return secToBeParent;
	}

	private SSection getCandidateParent(SSection ss) {
		SSection secToBeParent = this.getCurrentSection();
		while ((secToBeParent != null) && (!secToBeParent.isSuperSectionOf(ss))) {
			secToBeParent = secToBeParent.getParentSection();
		}
		return secToBeParent;
	}

	public SSection getCurrentSection() {
		if (readOnly)
			throw new IllegalArgumentException("Can't get current section in read mode");
		return currentSection;
	}

	public SSection getCurrentSuperSection() {
		if (readOnly)
			throw new IllegalArgumentException("Can't get current section in read mode");
		SSection toret = this.getCurrentSection();
		while (toret.getParentSection() != null)
			toret = toret.getParentSection();
		return toret;
	}

	public TreeSet<Definition> getAllDefinitions() {
		TreeSet<Definition> allDefinitions = new TreeSet<Definition>();
		allDefinitions.addAll(this.preamble.getDefinitions());
		for (SSection s : this.allSections) {
			allDefinitions.addAll(s.getDefinitions());
		}
		return allDefinitions;
	}

	/*
	 * public Map<String, TreeSet<Definition>> getTermToDeflist() { Map<String,
	 * TreeSet<Definition>> tmp = new HashMap<String, TreeSet<Definition>>(); for
	 * (Definition d : this.getAllDefinitions()) { TreeSet<Definition> curr =
	 * tmp.getOrDefault(d.getDefinitionTermString(), new TreeSet<Definition>());
	 * curr.add(d); tmp.put(d.getDefinitionTermString(), curr); } return tmp; }
	 */

	public Map<String, TreeSet<Definition>> getStemmedTermToDeflist() {
		Map<String, TreeSet<Definition>> tmp = new HashMap<String, TreeSet<Definition>>();
		for (Definition d : this.getAllDefinitions()) {
			TreeSet<Definition> curr = tmp.getOrDefault(d.getDefinitionTermStemmedString(), new TreeSet<Definition>());
			curr.add(d);
			tmp.put(d.getDefinitionTermStemmedString(), curr);
		}
		return tmp;
	}

	public HashMap<Definition, Integer> getAllDefinitionsMap() {
		TreeSet<Definition> allDefinitions = this.getAllDefinitions();
		HashMap<Definition, Integer> defToLen = new HashMap<Definition, Integer>();
		for (Definition d : allDefinitions) {
			defToLen.put(d, d.getDefinitionTerm().size());
		}
		return defToLen;
	}

	public String getSectionXML() {
		StringWriter w = new StringWriter();
		try {
			this.writeSections(w);
		} catch (FileNotFoundException e) {
			e.printStackTrace();
		}
		return w.toString();
	}

	public String getDefinitionXML() {
		StringWriter w = new StringWriter();
		try {
			this.writeDefinitions(w);
		} catch (FileNotFoundException | UnsupportedEncodingException e) {
			e.printStackTrace();
		}
		return w.toString();
	}

	public void writeSections(Writer outputFile) throws FileNotFoundException {
		SafeWriter pw = new SafeWriter(outputFile);
		pw.println("<xml>");
		bufferedRecursiveCallerExhibits(this.topLevelSections, "", pw);
		pw.println("</xml>");
		pw.close();
		this.printSections();
	}

	private void writeSectionsRec(SSection s, String spacing, SafeWriter pw) {
		pw.println(spacing
			+ "<section"
			+ " title='" + SafeWriter.safeStr(s.getSectionTitleString())
			+ "' literal='" + SafeWriter.safeStr(s.getSectionNumber() != null ? s.getSectionNumber().toString() : "")
			+ "' page='" + (s.getSectionNumber() != null ? s.getSectionNumber().getPageNum()
					: s.getSectionTitle().first().getPageNum())
			+ "' y='" + (s.getSectionNumber() != null ? s.getSectionNumber().getY()
					: (this.topLevelSections.contains(s) ? 0f : s.getSectionTitle().first().getY()))
			+ "' id='" + s.id
			+ "' qualified='" + SafeWriter.safeStr(s.getFullyQualifiedSectionNumber()) + "'"
			+ (" show=" + (s.showBookmark ? "'true'" : "'false'"))+ (s.bookmarkTitle != null ? " bookmark='" + s.bookmarkTitle.replace("'", "&#39;") + "'" : "")
			+ " type='" + SafeWriter.safeStr(s.getSectionLiteralString().toUpperCase()) + "'"
			+ " sectionStartHex='" + SafeWriter.safeStr(s.getSectionStartTokenHex()) + "'"
			+ " sectionEndHex='" + SafeWriter.safeStr(s.getSectionEndTokenHex())
			+ "'>");


		for (Reference<SSection> ref : s.getReferenceMentions()) {
			TextToken f = ref.getReferenceTokens().first();
			pw.println(spacing + "	"
				+ "<reference page='" + f.getPageNum()
				+ "' y='" + f.getY()
				+ "' section='" + ref.getSection().id
				+ "' referenceStartHex='" + SafeWriter.safeStr(ref.getReferenceStartHex())
				+ "' referenceEndHex='" + SafeWriter.safeStr(ref.getReferenceEndHex())
				+ "' />");
		}
		pw.flush();
		bufferedRecursiveCaller(s.getSubsections(), spacing + "	", pw);
		pw.println(spacing + "</section>");
		pw.flush();
	}

	private void bufferedRecursiveCallerExhibits(Collection<SSection> subsections, String spacing, SafeWriter pw) {
		if (subsections.isEmpty())
			return;
		boolean hasSeenScheduleOrAnnex = false;
		for (SSection ss : subsections) {
			if (ss.getSectionLiteralString() == null || ss.getSectionLiteralString().isEmpty()) {
				if (hasSeenScheduleOrAnnex) {
					hasSeenScheduleOrAnnex = false;
					pw.println(spacing + "</section>");
				}
				writeSectionsRec(ss, spacing, pw);
			} else {
				String lower = ss.getSectionLiteralString().trim().toLowerCase();
				if (lower.equals("exhibit")) {
					if (!hasSeenScheduleOrAnnex) {
						pw.println(spacing + "<section title='" + "Exhibits" + "' literal='" + "" + "' page='"
								+ (ss.getSectionNumber() != null ? ss.getSectionNumber().getPageNum()
										: ss.getSectionTitle().first().getPageNum())
								+ "' " + "y='"
								+ (ss.getSectionNumber() != null ? ss.getSectionNumber().getY()
										: ss.getSectionTitle().first().getY())
								+ "' id='" + (ss.id - 1) + "' qualified='" + "" + "'" + " type='" + "PSEUDO" + "'>");
						hasSeenScheduleOrAnnex = true;
					}
					writeSectionsRec(ss, spacing, pw);
				} else {
					if (hasSeenScheduleOrAnnex) {
						hasSeenScheduleOrAnnex = false;
						pw.println(spacing + "</section>");
					}
					writeSectionsRec(ss, spacing, pw);
				}
			}
		}
		if (hasSeenScheduleOrAnnex) {
			pw.println(spacing + "</section>");
		}
	}

	private void bufferedRecursiveCaller(Collection<SSection> subsections, String spacing, SafeWriter pw) {
		if (subsections.isEmpty())
			return;
		boolean hasSeenScheduleOrAnnex = false;
		for (SSection ss : subsections) {
			if (ss.getSectionLiteralString() == null || ss.getSectionLiteralString().isEmpty()) {
				if (hasSeenScheduleOrAnnex) {
					hasSeenScheduleOrAnnex = false;
					pw.println(spacing + "</section>");
				}
				writeSectionsRec(ss, spacing, pw);
			} else {
				String lower = ss.getSectionLiteralString().trim().toLowerCase();
				if (lower.equals("schedule") || lower.equals("annex") || lower.equals("attachment")) {
					if (!hasSeenScheduleOrAnnex) {
						pw.println(
									spacing
									+ "<section title='" + "Schedules and Annexes"
									+ "' literal='" + ""
									+ "' page='" + (ss.getSectionNumber() != null ? ss.getSectionNumber().getPageNum()
											: ss.getSectionTitle().first().getPageNum()) + "' "
									+ "y='" + (ss.getSectionNumber() != null ? ss.getSectionNumber().getY()
											: ss.getSectionTitle().first().getY())
									+ "' id='" + (ss.id - 1)
									+ "' qualified='" + "" + "'"
									+ " type='" + "PSEUDO"
									+ "'>"); // hack until we switch frontend to UUIDs instead of ordered-invariant
						hasSeenScheduleOrAnnex = true;
					}
					writeSectionsRec(ss, spacing, pw);
				} else {
					if (hasSeenScheduleOrAnnex) {
						hasSeenScheduleOrAnnex = false;
						pw.println(spacing + "</section>");
					}
					writeSectionsRec(ss, spacing, pw);
				}
			}
		}
		if (hasSeenScheduleOrAnnex) {
			pw.println(spacing + "</section>");
		}
	}

	public void printSections() {
		for (SSection s : this.getTopLevelSections()) {
			this.printSectionsRec(s, "");
		}
	}

	private void printSectionsRec(SSection s, String spacing) {
    //TODO: This is never used. Remove?
		String toPrint = spacing;
		if (s.getSectionLiteral() != null) {
			toPrint += s.getSectionLiteralString() + " " + s.getFullyQualifiedSectionNumber();
		} else {
			toPrint += s.getSectionTitleString();
		}
		for (SSection ss : s.getSubsections()) {
			printSectionsRec(ss, spacing + "	");
		}
	}

	public void writeDefinitions(Writer outputFile) throws FileNotFoundException, UnsupportedEncodingException {
		SafeWriter pw = new SafeWriter(outputFile);
		pw.println("<xml>");
		for (Definition d : this.getAllDefinitions()) {
			synchronized (d) {
				pw.printUnsafe(
						"<term name='" + SafeWriter.safeStr(d.getDefinitionTermString()) + "' id='" + d.id + "' sims='"
								+ d.getSimilarTerms().stream().map(def -> Integer.toString(def.id)).reduce("",
										(a, b) -> a + " " + b)
								+ "' page='" + d.getDefinitionTerm().first().getPageNum()
								+ "' y='" + d.getDefinitionTerm().first().getY()
								+ "' inline='" + Boolean.toString(d.type == DefType.PARENTETICAL)
								+ "' termStartHex='" + d.getTermStartTokenHex()
								+ "' termEndHex='" + d.getTermEndTokenHex()
								+ "'>");
				pw.println();
				pw.print("	<definition>");
				pw.printUnsafe(d.getDefinitionXML());
				d.linkUpReferences();
				pw.println("</definition>");
				pw.println("	<references>");

				for (Reference<Definition> r : d.getReferences()) {
					pw.println("		<reference"
							+ " page='" + r.getReferenceTokens().first().getPageNum() + "' "
							+ "y='" + r.getReferenceTokens().first().getY()
							+ "' section='" + r.getSection().id
							+ "' definition='" + (r.getEnclisingDefinition() != null ? r.getEnclisingDefinition().id : "")
							+ "' referenceStartHex='" + r.getReferenceStartHex()
							+ "' referenceEndHex='" + r.getReferenceEndHex()
							+ "' >");
					pw.println(SafeWriter.safeStr(r.getReferenceContext()));
					pw.println("</reference>");
				}
			}
			pw.println("	</references>");
			pw.println("</term>");
		}
		pw.println("</xml>");
		pw.close();
	}

	/**
	 * We don't want to add another SSection with the same literal in the same
	 * `namespace`. In other words, we don't want two sibling sections with the same
	 * literal. If an SSection already exists in the DOM at the same level with the
	 * same literal, we don't want to add this one.
	 *
	 * @return
	 */
	public boolean isDuplicateSection(TextToken candidateSectionLiteral, TextToken sectionNumber) {
		// Allow multiple exhibits with the same name at the root level
		boolean isExhibit = ((candidateSectionLiteral != null)
				&& (candidateSectionLiteral.toString().toLowerCase().equals("exhibit")));
		if (this.getCandidateParent(candidateSectionLiteral, sectionNumber) == null) {
			for (SSection tls : this.topLevelSections) {
				if (tls.matches(candidateSectionLiteral, sectionNumber))
					ad.detectDuplicateSection(sectionNumber);
				if (!isExhibit)
					return true;
			}
			return false;
		}
		List<SSection> siblings = this.getCandidateParent(candidateSectionLiteral, sectionNumber).getSubsections();
		for (SSection sibling : siblings) {
			if (sibling.matches(candidateSectionLiteral, sectionNumber)) {
				ad.detectDuplicateSection(sectionNumber);
				if (!isExhibit)
					return true;
			}
		}
		return false;
	}

	public boolean isDuplicateSection(TextBox tbox) {
		String text = tbox.getText();
		if (text == null || text.equals(""))
			return false;
		return this.getAllSections().parallelStream().map(a -> text.equals(a.getSectionTitleString())).reduce(false,
				(a, b) -> a || b);
	}

	private static List<SSection> getAllSiblings(SSection s) {
		if (s == null)
			return null;
		if (s.getParentSection() == null)
			return null;
		return s.getParentSection().getSubsections();
	}

	/**
	 * Recursively try to find a match for a candidate section reference by moving
	 * up the dom tree from the current section
	 *
	 * @param curSec
	 * @param numberTokens
	 * @return
	 */
	public SSection fetchSection(SSection owningSection, ArrayList<TextToken> numberTokens, String sectionLiteral) {
		// Don't return clauses
		if ((sectionLiteral != null) && (sectionLiteral.toString().toLowerCase().equals("clause")
				|| sectionLiteral.toString().toLowerCase().equals("paragraph"))) {
			if (numberTokens.isEmpty() || SSection.isSubsectionLiteral(numberTokens.get(0))) {
				return null;
			}
		}
		// Now do full fetch
		if (owningSection == null) {
			boolean earlyExit = true;
			for (TextToken t : numberTokens) {
				if (!SSection.isSubsectionLiteral(t)) {
					earlyExit = false;
					break;
				}
			}
			if (earlyExit) {
				if (sectionLiteral != null) {
					// To reduce false positives, we ensure that a sectionLiteral is the ~direct~
					// predessesor
					TextToken priorToken = numberTokens.get(0).getPrevToken();
					if ((priorToken != null) && (SSection.isSectionLiteralReference(priorToken))) {
						if (!processMissingSection(numberTokens)) {
							ad.detectBrokenSectionReference(sectionLiteral, numberTokens);
						}
					}
				}
				return null;
			}

			SSection tls = topLevelFetchSection(numberTokens, sectionLiteral);
			if (tls == null) {
				return fallbackAllSections(numberTokens, sectionLiteral);
			}
			return tls;
		}
		for (SSection candidate : owningSection.getSubsections()) {
			if (candidate.partialMatches(numberTokens, sectionLiteral)) {
				return candidate;
			}
		}
		return fetchSection(owningSection.getParentSection(), numberTokens, sectionLiteral);
	}

	private boolean processMissingSection(ArrayList<TextToken> numberTokens){
		TextToken curr = numberTokens.get(0);
		Set<String> triggerWords = AnomalyWordLists.missingSectionIndicator;
		boolean triggerFound = false;
		for (int i = 0; i < 8; i++) {
			if (triggerWords.contains(curr.toString().toLowerCase())) {
				triggerFound = true;
				break;
			}
			if (curr.getPrevToken() == null) break;
			curr = curr.getPrevToken();
		}
		curr = numberTokens.get(0);
		for (int i = 0; i < 8; i++) {
			if (triggerWords.contains(curr.toString().toLowerCase())) {
				triggerFound = true;
				break;
			}
			if (curr.getNextToken() == null) break;
			curr = curr.getNextToken();
		}
		return triggerFound;
	}

	// Top level sections parser
	private SSection topLevelFetchSection(ArrayList<TextToken> numberTokens, String sectionLiteral) {
		for (SSection candidate : this.topLevelSections) {
			if (candidate.partialMatches(numberTokens, sectionLiteral)) {
				return candidate;
			}
		}
		return null;
	}

	// Fallback parser
	private SSection fallbackAllSections(ArrayList<TextToken> numberTokens, String sectionLiteral) {
		for (SSection candidate : this.allSections) {
			if (candidate.partialMatches(numberTokens, sectionLiteral)) {
				return candidate;
			}
		}
		if (sectionLiteral != null) {
			// To reduce false positives, we ensure that a sectionLiteral is the ~direct~
			// predessesor
			TextToken priorToken = numberTokens.get(0).getPrevToken();
			if ((priorToken != null) && (SSection.isSectionLiteralReference(priorToken))) {
				if (!processMissingSection(numberTokens))
					ad.detectBrokenSectionReference(sectionLiteral, numberTokens);
			}
		}
		return null;
	}

	public boolean isMostlyUnnumbered() {
		if ((this.quantityUnnumberedSections > 3 * this.quantityNumberedSections)
				&& (this.quantityNumberedSections + this.quantityUnnumberedSections > 10)) {
			return true;
		}
		return false;
	}
}
