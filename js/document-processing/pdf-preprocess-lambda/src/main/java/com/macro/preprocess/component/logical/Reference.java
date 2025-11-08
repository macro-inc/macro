package com.macro.preprocess.component.logical;

import java.util.HashSet;
import java.util.Set;
import java.util.TreeSet;
import com.macro.preprocess.component.LogicalComponent;
import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.component.physical.TextChar;

public class Reference<T extends LogicalComponent> extends LogicalComponent {

	protected T pointerTo;
	protected SSection owningSection;
	protected Definition inBodyOf;
	protected TreeSet<TextToken> referenceText;
	private Set<T> potentialMatches;

	public Reference(T pointerTo, SSection owningSection) {
		this.pointerTo = pointerTo;
		this.owningSection = owningSection;
		this.referenceText = new TreeSet<TextToken>();
		this.potentialMatches = new HashSet<T>();
	}

	public Reference(T pointerTo, SSection owningSection, TreeSet<TextToken> referenceText) {
		this.pointerTo = pointerTo;
		this.owningSection = owningSection;
		this.referenceText = referenceText;
		for (TextToken t : referenceText) {
			t.setLogicalOwner(this);
		}
		this.potentialMatches = new HashSet<T>();
	}

	public TreeSet<TextToken> getReferenceTokens() {
		return this.referenceText;
	}

	public String getReferenceContext() {
		if (this.referenceText.isEmpty()) {
			return "";
		}

		String before = this.addNToks(15, this.referenceText.first(), true);
		String after = this.addNToks(15, this.referenceText.last(), false);

		StringBuilder sb = new StringBuilder();

		sb.append("...");
		sb.append(before);
		sb.append(" ");
		for (TextToken t : this.referenceText) {
			sb.append(t.toString());
			if (t.isHasEndingSpace())
				sb.append(" ");
		}
		sb.append(" ");
		sb.append(after);
		sb.append("...");

		return sb.toString();
	}

  public String getReferenceStartHex() {
		return ((TextChar) this.getReferenceTokens().first().getChildren().first()).hexColorCode;
	}

  public String getReferenceEndHex() {
    String potentialEndHex = ((TextChar) this.referenceText.last().getChildren().last()).hexColorCode;
	if (potentialEndHex == null) {
		return "";
	}
    if (potentialEndHex.equals("000000") && this.inBodyOf != null) {
      Object[] referenceTokens = this.referenceText.toArray();
      if(referenceTokens.length > 1) { // Ensure we never get IndexOutOfBounds
        return ((TextChar) ((TextToken) referenceTokens[referenceTokens.length - 2]).getChildren().last()).hexColorCode;
      }
    }

    return potentialEndHex;
  }

	private String addNToks(int number, TextToken token, boolean backwards) {
		TreeSet<TextToken> cum = new TreeSet<TextToken>();
		TextToken curToken = token;
		for (int i = 0; i < number; i++) {
			curToken = backwards ? curToken.getPrevToken() : curToken.getNextToken();
			if (curToken == null)
				break;
			cum.add(curToken);
		}
		if (cum.isEmpty())
			return "";
		StringBuilder sb = new StringBuilder();
		for (TextToken t : cum) {
			sb.append(t.toString());
			if (t.isHasEndingSpace())
				sb.append(" ");
		}
		String toret = sb.toString().trim();
		if (backwards) {
			toret = toret.substring(Math.max(toret.length() - 100, 0), toret.length());
		} else {
			toret = toret.substring(0, Math.min(toret.length(), 100));
		}
		return toret;
	}

	public void addToken(TextToken t) {
		if (t == null)
			return;
		t.setLogicalOwner(this);
		this.referenceText.add(t);
	}

	public Class<? extends LogicalComponent> getReferenceType() {
		return pointerTo.getClass();
	}

	/**
	 * Returns the primary resolved pointer. Pseudo-probabalistically the right
	 * match.
	 *
	 * @return LogicalComponent (SSection | Definition)
	 */
	public T getPointerTo() {
		return pointerTo;
	}

	/**
	 * Returns all possible matches for this reference.
	 *
	 * @return Collection<LogicalComponent (SSection | Definition)>
	 */
	public Set<T> getAllPotentalMatches() {
		return this.potentialMatches;
	}

	@SuppressWarnings("unchecked")
	public void addPotentialMatch(T potentialMatch) {
		this.potentialMatches.add(potentialMatch);
		if (this.pointerTo instanceof Definition) {
			for (Definition d : (Set<Definition>) (Set<?>) this.potentialMatches) {
				if (d.equals(potentialMatch))
					continue;
				d.setSimilarTerms((Set<Definition>) (Set<?>) this.potentialMatches);
			}
		}
	}

	public void setPointerTo(T pointerTo) {
		this.addPotentialMatch(pointerTo);
		this.pointerTo = pointerTo;
	}

	@Override
	public SSection getSection() {
		return this.owningSection;
	}

	@Override
	public void setSection(SSection section) {
		section.references.add(this);
		this.owningSection = section;
	}

	public Definition getEnclisingDefinition() {
		return this.inBodyOf;
	}
}
