package com.macro.preprocess.parse.util;

import java.util.Collection;
import java.util.HashMap;
import java.util.Map;
import java.util.TreeSet;

import org.ahocorasick.trie.Emit;
import org.ahocorasick.trie.Trie;

import com.macro.preprocess.component.LogicalComponent;
import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.logical.Definition;
import com.macro.preprocess.component.logical.Reference;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextToken;

/**
 * Helper class to find words and definitions in a document using modified KNP
 * Algo
 * 
 * @author Jacob
 */
public class DefinitionFinder {

	Trie trie;
	Map<String, TreeSet<Definition>> termToDeflist;
	Map<String, TreeSet<Definition>> termToDeflistLower = new HashMap<String, TreeSet<Definition>>();
	

	public DefinitionFinder(Map<String, TreeSet<Definition>> termToDeflist) {
		// TODO: run porter stemmer before creating the trie and mapping (maybe do this
		// in @PDFDOM)
		this.termToDeflist = termToDeflist;
		for (Map.Entry<String, TreeSet<Definition>> kv : termToDeflist.entrySet()) {
			termToDeflistLower.put(kv.getKey().toLowerCase(), kv.getValue());
		}
		this.trie = Trie.builder().addKeywords(termToDeflist.keySet()).ignoreOverlaps().onlyWholeWords().build();
	}

	public void createReferences(TextBox tbox) {
		// TODO: run porter stemmer over the textbox string before passing to other
		// functions
		Collection<Emit> emits = this.getEmits(tbox);
		for (Emit emit : emits) {
			if (emit.getEnd() > emit.getStart()) {
				TreeSet<Definition> definitionsForEmit = this.getDefinitionsForEmit(emit);
				this.createReference(this.getMatchesForEmit(emit, tbox), definitionsForEmit, tbox);
			}
		}
	}

	private Collection<Emit> getEmits(TextBox tbox) {
		String[] splitText = tbox.getStemmedText().split(" ");
		if (splitText.length == 1) return this.trie.parseText(tbox.getStemmedText());
		for (int i = 0; i < splitText.length; i++) {
			if (splitText[i].length() > 3)
				splitText[i] = Character.toUpperCase(splitText[i].charAt(0)) + splitText[i].substring(1);
		}
		String formattedText = String.join(" ", splitText);
		return this.trie.parseText(formattedText);
	}

	private TreeSet<TextToken> getMatchesForEmit(Emit emit, TextBox tbox) {
		// TODO: add tailset optimization i.e. only search starting from the last found
		// emit in order to make this O(n) not O(n^2)
		int start = 0;
		int end = 0;
		TreeSet<TextToken> ttt = new TreeSet<TextToken>();
		for (PhysicalComponent child : tbox.getChildren()) {
			TextToken tchild = (TextToken) child;
			start = end;
			end += tchild.toStemmedString().length() + (tchild.isHasEndingSpace() ? 1 : 0);
			// @start and @end are now correct
			if ((end > emit.getStart()) && (start < emit.getEnd())) {
				ttt.add(tchild);
			} else if (end > emit.getStart())
				break;
		}
		return ttt;
	}

	public TreeSet<Definition> getDefinitionsForEmit(Emit emit) {
		TreeSet<Definition> defs = this.termToDeflist.get(emit.getKeyword()); // will return null if casing doesn't match
		if (defs == null) {
			defs = this.termToDeflistLower.get(emit.getKeyword().toLowerCase());
		}
		return defs;
	}

	private void createReference(TreeSet<TextToken> ttt, TreeSet<Definition> matchingdefs, TextBox tbox) {
		for (TextToken t : ttt) {
			LogicalComponent owner = t.getLogicalOwner();
			if ((owner != null) && ((owner instanceof Reference) || (owner instanceof Definition))) {
				return; // don't add things that are already linked to another reference
			}
		}
		if (matchingdefs.isEmpty())
			return;

		Reference<Definition> dref = new Reference<Definition>(matchingdefs.first(),
				tbox.getLogicalOwner().getSection(), ttt);
		matchingdefs.first().addReference(dref);

		for (Definition d : matchingdefs) {
			d.isUsed = true;
			dref.addPotentialMatch(d);
		}
	}
}
