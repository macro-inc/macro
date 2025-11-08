package com.macro.preprocess.component.physical;

import java.util.TreeSet;
import org.apache.pdfbox.pdmodel.PDDocument;
import com.macro.preprocess.DocType;
import com.macro.preprocess.component.PhysicalComponent;

/**
 * Textboxes essentially represent "paragraphs" or common groups of text.
 * 
 * Textboxes are guarenteed to only have one type of font/size/type/etc. Further
 * processing into logical textboxes is done in the creation of LogicalComponent
 * Paragraph objects.
 * 
 * @author Jacob
 */
public class TextBox extends PhysicalComponent implements Comparable<PhysicalComponent> {

	protected String text;
	protected String stemmedText = null;
	protected boolean dirty;
	protected DocType docType;
	protected boolean bold;
	protected boolean italic;
	protected boolean upperCase;
	protected Float getXCached = null;
	protected Float getYCached = null;
	protected Float getWidthCached = null;
	protected Float getHeightCached = null;
	private short titleScore = -1;
	public static final short TITLE_THRESHOLD = 19;

	public String getText() {
		if ((!this.dirty) && (this.text != null))
			return text;
		StringBuilder sb = new StringBuilder();
		for (PhysicalComponent child : this.getChildren()) {
			TextToken t = (TextToken) child;
			sb.append(t.toString());
			if (t.isHasEndingSpace())
				sb.append(' ');
		}
		this.text = sb.toString();
		this.dirty = false;
		return this.text;
	}
	
	public String getStemmedText() {
		if ((!this.dirty) && (this.stemmedText != null))
			return this.stemmedText;
		StringBuilder sb = new StringBuilder();
		for (PhysicalComponent child : this.getChildren()) {
			TextToken t = (TextToken) child;
			sb.append(t.toStemmedString());
			if (t.isHasEndingSpace())
				sb.append(' ');
		}
		this.stemmedText = sb.toString();
		this.dirty = false;
		return this.stemmedText;
	}

	@Override
	public void addChild(PhysicalComponent child) {
		super.addChild(child);
		this.dirty = true;
	}

	public float getX() {
		if ((!this.dirty) && (this.getXCached != null)) return this.getXCached;
			float minX = Float.MAX_VALUE;
			for (PhysicalComponent child : getChildren()) {
				float cX = child.getX();
				if (cX < minX)
					minX = cX;
			}
			this.getXCached = minX;
			return minX;
		
	}

	public float getY() {
		if ((!this.dirty) && (this.getYCached != null)) return this.getYCached;
			float minY = Float.MAX_VALUE;
			for (PhysicalComponent child : getChildren()) {
				float cY = child.getY();
				if (cY < minY)
					minY = cY;
			}
			this.getYCached = minY;
			return minY;
		
	}

	public float getWidth() {
		if ((!this.dirty) && (this.getWidthCached != null)) return this.getWidthCached;
			float maxX = 0f;
			for (PhysicalComponent child : getChildren()) {
				float cX = child.getX() + child.getWidth();
				if (cX > maxX)
					maxX = cX;
			}
			this.getWidthCached = maxX - this.getX();
			return maxX - this.getX();
		
	}

	public float getHeight() {
		if ((!this.dirty) && (this.getHeightCached != null)) return this.getHeightCached;
			float maxY = 0f;
			for (PhysicalComponent child : getChildren()) {
				float cY = child.getY() + child.getHeight();
				if (cY > maxY)
					maxY = cY;
			}
			this.getHeightCached = maxY - this.getY();
			return maxY - this.getY();
	}

	@Override
	public int getPageNum() {
		if (this.getChildren() == null)
			return 0;
		if (this.getChildren().isEmpty())
			return 0;
		return (this.getChildren().first().getPageNum());
	}

	/**
	 * Fuzzy logic to determine if a given textbox is a footer.
	 * 
	 * @return
	 */
	public boolean isProbablyFooter(TreeSet<TextBox> pageBoxes) {
		// Determine the number of this box on the page
		int i = 0;
		for (TextBox tbox : pageBoxes) {
			if (this.equals(tbox))
				break;
			i++;
		}
		TreeSet<PhysicalComponent> children = this.getChildren();
		float fuzzy = 0f;
		if (this.getY() > this.document.getPage(this.getPageNum()).getBBox().getHeight() * 0.8f) {
			fuzzy += .2f;
		}
		if (i > pageBoxes.size() - 4)
			fuzzy += .2f;
		if (i >= pageBoxes.size() - 1)
			fuzzy += .35f;
		if (children.size() < 2)
			fuzzy += .2f;
		if (children.size() > 10)
			fuzzy -= .4f;
		if (this.getX() > this.document.getPage(this.getPageNum()).getBBox().getWidth() * 0.3f) {
			fuzzy += .2f;
		}
		float lineheight = children.first().getHeight();
		if (this.getHeight() > lineheight * 2.5f)
			fuzzy -= .5f;
		return fuzzy > .39f;
	}

	/**
	 * Fuzzy logic to determine if a given textbox is a header.
	 * 
	 * @return
	 */
	public boolean isProbablyHeader(TreeSet<TextBox> pageBoxes) {
		// Determine the number of this box on the page
		int i = 0;
		for (TextBox tbox : pageBoxes) {
			if (this.equals(tbox))
				break;
			i++;
		}
		TreeSet<PhysicalComponent> children = this.getChildren();
		float fuzzy = 0f;
		if (this.getY() < this.document.getPage(this.getPageNum()).getBBox().getHeight() * 0.1f) {
			fuzzy += .1f;
		}
		if (i == 0)
			fuzzy += .2f;
		if (children.size() < 5)
			fuzzy += .2f;
		if (children.size() > 10)
			fuzzy -= .2f;
		if (this.getX() > this.document.getPage(this.getPageNum()).getBBox().getWidth() * 0.27f) {
			fuzzy += .2f;
		} else {
			fuzzy -= .2f;
		}
		float lineheight = children.first().getHeight();
		if (this.getHeight() > lineheight * 2.5f)
			fuzzy -= .5f;
		return fuzzy > .39f;
	}

	/**
	 * Checks if the TextBox is a title
	 * 
	 * @return true if is title
	 */
	public boolean isProbablyTitle(float modeCharSize) {
		if (this.titleScore >= 0)
			return this.isTitleCached(); // only run once
		// Pre-checks
		if (this.getX() > this.getDocument().getPage(this.getPageNum()).getBBox().getWidth() * 0.5) {
			return false;
		}
		TreeSet<PhysicalComponent> children = this.getChildren();
		if (children.size() == 1) {
			if (children.first().getChildren().size() < 5)
				return false;
		}
		if (children.size() > 1) {
			String first = children.first().toString();
			if (first.isEmpty())
				return false; // npe check
			// Special check for agreements first
			for (PhysicalComponent child : children) {
				String lower = child.toString().toLowerCase().trim();
				if (lower.equals("agreement")) {
					if (this.isCentered() && (children.size() < 15)) {
						return true;
					} else
						break;
				}
			}
			// End of special check for agreements
			char firstChar = first.charAt(0);
			if ((!Character.isLetterOrDigit(firstChar)) && (firstChar != '$')) {
				return false;
			}
			if ((Character.isLetter(firstChar)) && (!Character.isUpperCase(firstChar))) {
				return false;
			}
		}
		if (!this.isMostlyAlphabetic())
			return false;
		if (!this.wordDistanceTest())
			return false;
		// Checks
		bold = true;
		italic = true;
		short numWords = 0;
		upperCase = true;
		float titleCaseAvg = 0;
		float avgSize = 0;
		for (PhysicalComponent child : children) {
			TextToken tt = (TextToken) child;
			// BOLD CHECK
			if (!tt.isBold())
				bold = false;
			// ITALIC CHECK
			if (!tt.isItalic())
				italic = false;
			// NUMBER OF WORDS CHECK
			numWords += 1;
			// IS ALL UPPER?
			if (!tt.isAllUpperCase())
				upperCase = false;
			// IS TITLE CASE?
			if (tt.isTitleCase()) {
				titleCaseAvg += 1;
			}
			// SIZE
			avgSize += tt.getCssHeight();
		}
		avgSize = avgSize / (numWords + 1e-8f);
		titleCaseAvg = titleCaseAvg / (numWords + 1e-8f);
		if (avgSize < modeCharSize - 3.5)
			return false;
		if (numWords > 12)
			return false;
		short totalScore = 0;
		if (bold)
			totalScore += 10;
		if (italic)
			totalScore += 10;
		if (numWords < 8)
			totalScore += 10;
		if (upperCase)
			totalScore += 10;
		if (titleCaseAvg > .75f)
			totalScore += 10;
		if (avgSize > modeCharSize + 1)
			totalScore += 10;
		if (this.getY() < this.document.getPage(this.getPageNum()).getBBox().getHeight() * 0.1f) {
			totalScore -= 2;
		}
		this.titleScore = totalScore;
		return totalScore > TITLE_THRESHOLD;
	}

	/**
	 * Return true if the given paragraph is a multiline paragraph with indent
	 * 
	 * @return
	 */
	public boolean isMultilineParagraph() {
		PhysicalComponent first = this.getChildren().first();
		if (first.getX() < this.getX() + 3f) { // not indented
			return false;
		}
		if (this.getHeight() < first.getHeight() * 2) {
			return false;
		}
		if (this.getChildren().size() < 20) {
			return false;
		}
		return true;
	}

	@Override
	public PDDocument getDocument() {
		return this.getChildren().first().getDocument();
	}

	public short getTitleScore() {
		return this.titleScore;
	}

	public boolean isTitleCached() {
		return this.titleScore > TITLE_THRESHOLD;
	}

	public float getCssHeight() {
		if (this.getChildren().isEmpty()) {
			return 0;
		}
		return ((TextToken) this.getChildren().first()).getCssHeight();
	}

	public boolean isMostlyAlphabetic() {
		int num = 0;
		for (Character c : this.getText().toCharArray()) {
			if (Character.isLetter(c))
				num += 1;
		}
		return ((float) num / (float) this.getText().length()) > .3f ;
	}

	public boolean isCentered() {
		if (this.getChildren().isEmpty())
			return false;
		float tboxCenter = (this.getX() + this.getX() + this.getWidth()) / 2;
		float realCenter = this.getDocument().getPage(this.getPageNum()).getBBox().getWidth() / 2;
		return Math.abs(tboxCenter - realCenter) < 30;
	}

	public static boolean isCentered(PhysicalComponent first, PhysicalComponent last) {
		float tboxCenter = (first.getX() + (last.getX() + last.getWidth())) / 2;
		float realCenter = first.getDocument().getPage(first.getPageNum()).getBBox().getWidth() / 2;
		return Math.abs(tboxCenter - realCenter) < 30;
	}

	public boolean wordDistanceTest() {
		if (this.getChildren().size() < 2)
			return true;
		PhysicalComponent last = this.getChildren().first();
		float maxDist = this.getCssHeight() * 3;
		for (PhysicalComponent t : this.getChildren().tailSet(this.getChildren().first(), false)) {
			if (Math.abs(last.getY() - t.getY()) < PhysicalComponent.SPACING_TOLERANCE) {
				float end = last.getX() + last.getWidth();
				if (t.getX() - end > maxDist)
					return false;
			}
			last = t;
		}
		return true;
	}

	/**
	 * Search for a phrase and return the first TextToken that matches the start of that phrase.
	 * NOTE: This will only accept plain word sequences (no punctuation, etc.).
	 * Example input: "shall mean", 5 - will search for "shall mean" in the first 5 tokens.
	 */
	public TextToken searchForPhraseInTokens(String searchStr, int threshold) {
		String[] strArr = searchStr.split(" ");
		int k = 0;
		TextToken currToken = (TextToken) this.getChildren().first();
		TextToken startToken = null;
		int count = 0;
		while (currToken != null && count < threshold) {
			if (currToken.toString().equals(strArr[k])) {
				if (k == 0) startToken = currToken;
				k++;
				if (k == strArr.length) {
					return startToken;
				}
			} else if (currToken.toString().equals(strArr[0])) {
				k = 1;
				startToken = currToken;
			} else {
				k = 0;
				startToken = null;
			}
			currToken = (TextToken) this.getChildren().higher(currToken);
			count++;
		}
		return null;
	}

	public void setDocType(DocType d) {
		this.docType = d;
	}
	
	public boolean isAllBold() {
		return this.bold;
	}
	
	public boolean isAllUppercase() {
		return this.upperCase;
	}
	
	public boolean isAllItalic() {
		return this.italic;
	}
}
