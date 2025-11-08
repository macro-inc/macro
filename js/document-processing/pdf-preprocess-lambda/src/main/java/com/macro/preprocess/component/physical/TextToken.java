package com.macro.preprocess.component.physical;

import java.io.IOException;
import java.util.TreeSet;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.font.PDFont;

import com.google.common.primitives.Ints;
import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.logical.SSection;
import com.macro.preprocess.parse.ie.credit.LeverageRatio;
import com.macro.preprocess.parse.util.nlp.Stemmer;

/**
 * Represents one congiguous (no space) block of text, such as an English word
 * or name. TextToken contains references to TextChar's which constitute it.
 * TextToken can only be the child of a TextBox. TextToken cannot have its own
 * logical owner. TextToken's text can not contain spaces.
 * 
 * @author Jacob
 */

public class TextToken extends PhysicalComponent implements Comparable<PhysicalComponent> {

	private PDFont font;
	private float cssHeight = Integer.MAX_VALUE;
	protected boolean hasEndingSpace;
	protected StringBuilder text;
	String stemmed = null;
	protected TextToken nextToken;
	protected TextToken prevToken;
	protected boolean dirty; // optimization: no new char has been added -> no need to recalculate string
	protected SpecialType specialType = SpecialType.NOT_YET_COMPUTED;

	enum SpecialType {
		NOT_YET_COMPUTED, NOT_SPECIAL, SPECIAL
	}

	public TextToken() {
		this.dirty = false;
	}

	public TextToken(boolean hasEndingSpace, int page) {
		this.dirty = false;
		this.hasEndingSpace = hasEndingSpace;
		this.pageNum = page;
	}

	public TextToken(TextBox parent, PDFont font, int page) {
		super();
		this.dirty = false;
		this.setParent(parent);
		this.setFont(font);
		this.setPageNum(page);
	}

	@Override
	public TextBox getParent() {
		return (TextBox) this.parent;
	}

	public void setParent(TextBox parent) {
		this.parent = parent;
		this.parent.addChild(this);
	}

	/**
	 * Must be of same font as other characters in this TextToken. There is no
	 * requirement that children be added in reading-order as the TreeSet data
	 * structure takes care of this ordering.
	 * 
	 * @param child
	 * @throws Exception
	 */
	public void addChild(TextChar child) throws IOException {
		super.addChild(child);
		this.font = child.textPosition.getFont();
		this.dirty = true;
		this.cssHeight = Math.min(this.cssHeight, child.getCssHeight());
	}

	/**
	 * Checks if the TextPosition in question is compatible with the current
	 * TextToken
	 * 
	 * @return true
	 */
	public boolean canAdd(TextChar candidate) {
		if (this.getChildren().isEmpty())
			return true;
		if (Math.abs(this.cssHeight - candidate.getCssHeight()) > 3.5f)
			return false;
		return true;
	}

	/**
	 * Get text in reading order.
	 * 
	 * @return The unicode text of the constituent tokens.
	 */
	@Override
	public String toString() {
		if ((!this.dirty) && (this.text != null))
			return this.text.toString();
		TreeSet<PhysicalComponent> children = this.getChildren();
		if (children.isEmpty()) {
			this.text = new StringBuilder("");
			return this.text.toString();
		}
		this.text = new StringBuilder();
		for (PhysicalComponent child : children) {
			TextChar txtCharChild = (TextChar) child;
			if (txtCharChild.textPosition.getUnicode().charAt(0) != 61623)
				this.text.append(txtCharChild.textPosition.getUnicode());
			else
				this.text.append((char) 8226); // replace [?] character with bullet point
		}
		this.dirty = false;
		return this.text.toString();
	}

	public String toStemmedString() {
		if ((this.stemmed != null) && (!this.dirty))
			return this.stemmed;
		if (this.toString().length() < 4) {
			this.stemmed = this.toString();
			return this.stemmed;
		}
		Stemmer s = new Stemmer();
		s.add(this.toString().toCharArray(), this.toString().length());
		s.stem();
		this.stemmed = s.toString();
		return this.stemmed;
	}

	public PDFont getFont() {
		return font;
	}

	public void setFont(PDFont font) {
		this.font = font;
	}

	public float getX() {
		if (this.getChildren().isEmpty())
			return 0;
		return this.getChildren().first().getX();
	}

	public float getY() {
		if (this.getChildren().isEmpty())
			return 0;
		return this.getChildren().first().getY();
	}

	public float getWidth() {
		if (this.getChildren().isEmpty())
			return 0;
		PhysicalComponent first = this.getChildren().first();
		PhysicalComponent last = this.getChildren().last();
		float lastX = last.getX() + last.getWidth();
		return lastX - first.getX();
	}

	public float getHeight() {
		if (this.getChildren().isEmpty())
			return 0;
		return this.getChildren().first().getHeight();
	}

	/**
	 * Can't automatically set the x,y because it is determined by the constituents.
	 */
	public void setX() {
		return;
	}

	public void setY() {
		return;
	}

	public void setWidth() {
		return;
	}

	public void setHeight() {
		return;
	}

	public float getCssHeight() {
		if (this.cssHeight == Integer.MAX_VALUE)
			return 0;
		return cssHeight;
	}

	public boolean isHasEndingSpace() {
		return hasEndingSpace;
	}

	public void setHasEndingSpace(boolean hasEndingSpace) {
		this.hasEndingSpace = hasEndingSpace;
	}

	public TextToken getNextToken() {
		return this.nextToken;
	}

	public void setNextToken(TextToken token) {
		this.nextToken = token;
		token.prevToken = this;
	}

	public TextToken getPrevToken() {
		return this.prevToken;
	}

	public float trailingHilightDistance() {
		if (this.nextToken == null)
			return 0f;
		return this.nextToken.getX() - (this.getX() + this.getWidth());
	}

	@Override
	public PDDocument getDocument() {
		return this.getChildren().first().getDocument();
	}

	public boolean isBold() {
		if (this.getFont() == null || this.getFont().getName() == null)
			return false;
		return this.getFont().getName().toLowerCase().contains("bold");
	}

	public boolean isItalic() {
		if ((this.getFont() == null) || (this.getFont().getName() == null))
			return false;
		return this.getFont().getName().toLowerCase().contains("italic");
	}

	public boolean isAllUpperCase() {
		for (Character c : this.toString().toCharArray()) {
			if (Character.isLowerCase(c)) {
				return false;
			}
		}
		return true;
	}

	public boolean isTitleCase() {
		if (this.toString().isEmpty())
			return false;
		return Character.isUpperCase(this.toString().charAt(0));
	}

	public boolean isInSection() {
		if (this.logicalOwner == null)
			return false;
		if (this.logicalOwner.getSection() == null)
			return false;
		SSection own = this.logicalOwner.getSection();
		if ((own.getSectionTitle() != null) && own.getSectionTitle().contains(this))
			return true;
		if ((own.getSectionLiteral() != null) && own.getSectionLiteral().equals(this))
			return true;
		if ((own.getSectionNumber() != null) && own.getSectionNumber().equals(this))
			return true;
		return false;
	}

	/**
	 * E.g. money, number, date, etc.
	 * 
	 * @return true if special token
	 */
	private void computeSpecialToken() {
		Integer i;
		// If not memoized, compute (base case first)
		boolean seenDigit = false;
		boolean seenCurrency = false;
		for (Character c : this.toString().toCharArray()) {
			if (Character.getType(c) == Character.CURRENCY_SYMBOL)
				seenCurrency = true;
			else if (Character.isDigit(c))
				seenDigit = true;
			if (seenCurrency && seenDigit) {
				this.specialType = SpecialType.SPECIAL;
				return;
			}
		}
		if (seenCurrency && !seenDigit) {
			if (this.getNextToken() != null) {
				for (Character c : this.getNextToken().toString().toCharArray()) {
					if (Character.isDigit(c)) {
						this.specialType = SpecialType.SPECIAL;
						this.getNextToken().specialType = SpecialType.SPECIAL;
						return;
					}
				}
			}
		}
		if (this.toString().charAt(0) == '%') {
			this.specialType = SpecialType.SPECIAL;
		} else if ((i = Ints.tryParse(this.toString())) != null) {
			if ((i < 2070) && (i > 1980)) {
				this.specialType = SpecialType.SPECIAL;
			}
		} else if (LeverageRatio.isFloat(this.toString()) || (Ints.tryParse(this.toString()) != null)) {
			if ((this.getNextToken() != null) && (this.getNextToken().toString().toLowerCase().equals("to"))) {
				this.specialType = SpecialType.SPECIAL;
				this.getNextToken().specialType = SpecialType.SPECIAL;
			} else if ((this.getPrevToken() != null) && (this.getPrevToken().toString().toLowerCase().equals("to"))) {
				this.specialType = SpecialType.SPECIAL;
				this.getPrevToken().specialType = SpecialType.SPECIAL;
			} else if ((this.getNextToken() != null)
					&& (this.getNextToken().toString().toLowerCase().equals("percent"))) {
				this.specialType = SpecialType.SPECIAL;
				this.getNextToken().specialType = SpecialType.SPECIAL;
			}
		}
	}

	public boolean isSpecialToken() {
		// If memoized, return the memo value
		if (this.specialType != SpecialType.NOT_YET_COMPUTED) {
			return this.specialType == SpecialType.SPECIAL;
		}
		if (this.getChildren().isEmpty())
			return false;
		computeSpecialToken();
		return this.specialType == SpecialType.SPECIAL;
	}
}
