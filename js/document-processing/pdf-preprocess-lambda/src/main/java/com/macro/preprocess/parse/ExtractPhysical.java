package com.macro.preprocess.parse;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.TreeSet;
import java.util.regex.Pattern;

import com.macro.preprocess.nlp.EnglishTokenizer;
import com.macro.preprocess.nlp.Tokenizer;
import com.macro.preprocess.nlp.token.Token;
import org.apache.pdfbox.contentstream.operator.color.*;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageTree;
import org.apache.pdfbox.text.PDFTextStripper;
import org.apache.pdfbox.text.TextPosition;
import org.apache.pdfbox.pdmodel.graphics.color.PDColor;

import com.macro.preprocess.component.logical.SSection;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextChar;
import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.parse.ie.credit.LeverageRatio;

/**
 * Extract PhysicalComponent's from a PDF document.
 *
 * @author Jacob
 */
public class ExtractPhysical extends PDFTextStripper {

	private List<TreeSet<TextToken>> allTokens;
	private List<TreeSet<TextBox>> allTextBoxes;
	private TextBox currentTextBox;
	Tokenizer tokenizer;
	private int[] lineDistances;
	private int[] charSizes;
	int modeLineDistance = 8;
	public int modeCharSize = 13;
	int linenum = 0;
	final int LINE_HEIGHT_RECOMPUTE;
	Iterator<TextPosition> tpIterator;
	TextPosition next;
	TreeSet<TextToken> toret;
	TextToken currentToken = null;
	TextToken prevToken = null;
	PageInfoCache pageInfoCache;
	HashMap<TextPositionWithPage, String> hexColorCodeHashmap;
	private static final Pattern spacePattern = Pattern.compile("\\n|\\r|\\xa0|\\s|\\u1680|\\u2000|\\u2001|\\u2002|\\u2003|\\u2004|\\u2005|\\u2006|\\u2007|\\u2008|\\u2009|\\u200A|\\u200B|\\u200C|\\u200D|\\u200E|\\u200F|\\u2028|\\u2029|\\u202F|\\u205F|\\u3000", Pattern.CASE_INSENSITIVE);
	private static final Pattern badCharPattern = Pattern.compile("[\\s\\p{Z}]+", Pattern.CASE_INSENSITIVE);

	private class TextPositionWithPage {
		private TextPosition textPosition;
		private int page;

		public TextPositionWithPage(TextPosition textPosition, int page) {
			this.textPosition = textPosition;
			this.page = page;
		}

		public TextPosition getTextPosition() {
			return this.textPosition;
		}

		public int getPage() {
			return this.page;
		}

		@Override
		public int hashCode() {
			return 31 * this.textPosition.hashCode() + this.page;
		}

		@Override
		public boolean equals(Object o) {
			if (this == o) {
				return true;
			}

			if (!(o instanceof TextPositionWithPage)) {
				return false;
			}

			TextPositionWithPage other = (TextPositionWithPage) o;
			return this.textPosition.equals(other.getTextPosition()) && this.page == other.getPage();
		}
	}

	public ExtractPhysical(PDDocument document, PageInfoCache pageInfoCache) throws IOException {
		super();

		// TODO- does this properly get the colors??
		addOperator(new SetStrokingColorSpace());
		addOperator(new SetNonStrokingColorSpace());
		addOperator(new SetStrokingDeviceCMYKColor());
		addOperator(new SetNonStrokingDeviceCMYKColor());
		addOperator(new SetNonStrokingDeviceRGBColor());
		addOperator(new SetStrokingDeviceRGBColor());
		addOperator(new SetNonStrokingDeviceGrayColor());
		addOperator(new SetStrokingDeviceGrayColor());
		addOperator(new SetStrokingColor());
		addOperator(new SetStrokingColorN());
		addOperator(new SetNonStrokingColor());
		addOperator(new SetNonStrokingColorN());

		super.setSortByPosition(true);
		this.setStartPage(0);
		this.setEndPage(document.getNumberOfPages());
		this.document = document;
		this.allTokens = new ArrayList<TreeSet<TextToken>>();

		this.tokenizer = new EnglishTokenizer();
		for (int i = 0; i <= this.document.getNumberOfPages(); i++) {
			this.allTokens.add(new TreeSet<TextToken>());
		}

		this.allTextBoxes = new ArrayList<TreeSet<TextBox>>();
		for (int i = 0; i <= this.document.getNumberOfPages(); i++) {
			this.allTextBoxes.add(new TreeSet<TextBox>());
		}
		if (document.getNumberOfPages() < 4) {
			LINE_HEIGHT_RECOMPUTE = 10;
		} else if (document.getNumberOfPages() < 20) {
			LINE_HEIGHT_RECOMPUTE = 20;
		} else {
			LINE_HEIGHT_RECOMPUTE = 100;
		}
		this.charSizes = new int[LINE_HEIGHT_RECOMPUTE];
		this.lineDistances = new int[LINE_HEIGHT_RECOMPUTE];

		this.pageInfoCache = pageInfoCache;

    this.hexColorCodeHashmap = new HashMap<>();
	}

	/**
	 * handles the line separator for a new line given the specified current and
	 * previous TextPositions.
	 *
	 * @param current               the current text position
	 * @param lastPosition          the previous text position
	 * @param lastLineStartPosition the last text position that followed a line
	 *                              separator.
	 * @param maxHeightForLine      max height for positions since
	 *                              lastLineStartPosition
	 * @return start position of the last line
	 * @throws IOException if something went wrong
	 */
	@Override
	public PositionWrapper handleLineSeparation(PositionWrapper current, PositionWrapper lastPosition,
			PositionWrapper lastLineStartPosition, float maxHeightForLine) throws IOException {
		this.linenum++;
		current.setLineStart();
		// RECOMPUTE MODES AT INTERVAL
		isParagraphSeparation(current, lastPosition, lastLineStartPosition, maxHeightForLine);
		if (this.linenum % LINE_HEIGHT_RECOMPUTE == 0) {
			this.calculateModeLineDistance();
			this.calculateModeCharSize();
			this.lineDistances = new int[LINE_HEIGHT_RECOMPUTE];
		}
		// APPEND LINE HEIGHT AND CHAR SIZE FOR CURRENT ITERATION
		this.lineDistances[this.linenum % LINE_HEIGHT_RECOMPUTE] = ((int) (current.getTextPosition().getY()
				- (lastPosition.getTextPosition().getY() + lastPosition.getTextPosition().getHeight())));

		this.charSizes[this.linenum % LINE_HEIGHT_RECOMPUTE] = (int) lastPosition.getTextPosition().getXScale();

		// DETERMINE PARAGRAPH START LOGIC
		if ((current.getTextPosition().getX() < 200f)
				&& (lastPosition.getTextPosition().getX() < this.getCurrentPage().getBBox().getWidth() * 0.75)) {
			current.setParagraphStart();
		}
		if (current.isParagraphStart()) {
			if (lastPosition.isArticleStart()) {
				if (lastPosition.isLineStart()) {
					writeLineSeparator();
				}
				writeParagraphStart();
			} else {
				writeLineSeparator();
				writeParagraphSeparator();
			}
		} else {
			writeLineSeparator();
		}
		lastLineStartPosition = current;
		return lastLineStartPosition;
	}

	@Override
	public void isParagraphSeparation(PositionWrapper position, PositionWrapper lastPosition,
            PositionWrapper lastLineStartPosition, float maxHeightForLine)
    {
        boolean result = false;
        if (lastLineStartPosition == null)
        {
            result = true;
        }
        else
        {
            float yGap = Math.abs(position.getTextPosition().getY()
                    - (lastPosition.getTextPosition().getY() + lastPosition.getTextPosition().getHeight()));
            float newYVal = this.modeLineDistance;
            // do we need to flip this for rtl?
            float xGap = position.getTextPosition().getXDirAdj()
                    - lastLineStartPosition.getTextPosition().getXDirAdj();
            float newXVal = multiplyFloat(getIndentThreshold(),
                    position.getTextPosition().getWidthOfSpace());
            float positionWidth = multiplyFloat(0.25f, position.getTextPosition().getWidth());

            if (yGap > newYVal + 2)
            {
                result = true;
            }
            else if (xGap > newXVal)
            {
                // text is indented, but try to screen for hanging indent
                if (!lastLineStartPosition.isParagraphStart())
                {
                    result = true;
                }
                else
                {
                    position.setHangingIndent();
                }
            }
            else if (xGap < -position.getTextPosition().getWidthOfSpace())
            {
                // text is left of previous line. Was it a hanging indent?
                if (!lastLineStartPosition.isParagraphStart())
                {
                    result = true;
                }
            }
            else if (Math.abs(xGap) < positionWidth)
            {
                // current horizontal position is within 1/4 a char of the last
                // linestart. We'll treat them as lined up.
                if (lastLineStartPosition.isHangingIndent())
                {
                    position.setHangingIndent();
                }
                else if (lastLineStartPosition.isParagraphStart())
                {
                    // check to see if the previous line looks like
                    // any of a number of standard list item formats
                    Pattern liPattern = matchListItemPattern(lastLineStartPosition);
                    if (liPattern != null)
                    {
                        Pattern currentPattern = matchListItemPattern(position);
                        if (liPattern == currentPattern)
                        {
                            result = true;
                        }
                    }
                }
            }
        }
        if (result)
        {
            position.setParagraphStart();
        }
    }

	public static int mode(int[] array) {
		HashMap<Integer, Integer> hm = new HashMap<Integer, Integer>();
		int max = 1;
		int temp = 0;
		for (int i = 0; i < array.length; i++) {
			if (hm.get(array[i]) != null) {
				int count = hm.get(array[i]);
				count++;
				hm.put(array[i], count);
				if (count > max) {
					max = count;
					temp = array[i];
				}
			} else {
				hm.put(array[i], 1);
			}
		}
		return temp;
	}

	private void calculateModeLineDistance() {
		this.modeLineDistance = mode(this.lineDistances);
	}

	private void calculateModeCharSize() {
		this.modeCharSize = mode(this.charSizes);
	}

	/**
	 * Compress multiline TextBoxes into one if they are overlapping and have the
	 * same font. TODO make sure that different fonts don't belong in the same
	 * TextBox.
	 */
	@Override
	public void writeParagraphEnd() {
		if (this.currentTextBox != null && !this.currentTextBox.getChildren().isEmpty()) {
			boolean overlaps = false;
			TreeSet<TextBox> pageTextBoxes = this.getAllBoxesForPage(this.getCurrentPageNo() - 1);
			/*if (!pageTextBoxes.isEmpty()) {
				TextBox lastTextBox = pageTextBoxes.last();
				// Don't merge multiline textboxes:
				overlaps = lastTextBox.overlaps(currentTextBox, (float) this.modeLineDistance - this.modeCharSize)
						&& (!currentTextBox.isMultilineParagraph());
				TextToken first = (TextToken) currentTextBox.getChildren().first();
				if ((SSection.isSectionLiteral(first) || SSection.isSectionNumber(first, true, true))
						&& (!SSection.isSectionLiteral((TextToken) lastTextBox.getChildren().last()))) {
					if ((Math.abs(currentTextBox.getX() - lastTextBox.getX()) > 4f) && (lastTextBox.getX()
							+ lastTextBox.getWidth() < this.getCurrentPage().getBBox().getWidth() * 0.75)) {
						overlaps = lastTextBox.overlaps(currentTextBox, (float) this.modeLineDistance)
								&& (!currentTextBox.isMultilineParagraph());
					}
				}
				if (currentTextBox.getChildren().first().getX() > lastTextBox.getX() + 16f) {
					TextToken firstChild = (TextToken) lastTextBox.getChildren().first();
					if (!((SSection.isSectionLiteral(firstChild)
							|| SSection.isSectionNumber(firstChild, false, true)))) {
						overlaps = false;
					}
				}
				if (overlaps) {
					pageTextBoxes.remove(lastTextBox);
					for (PhysicalComponent child : this.currentTextBox.getChildren()) {
						lastTextBox.addChild(child);
					}
					pageTextBoxes.add(lastTextBox);
					synchronized (this) {
						this.allTextBoxes.set(this.getCurrentPageNo() - 1, pageTextBoxes);
					}
				}
			} */
			if (!overlaps) {
				pageTextBoxes.add(currentTextBox);
				synchronized (this) {
					this.allTextBoxes.set(this.getCurrentPageNo() - 1, pageTextBoxes);
				}
			}
		}
		this.currentTextBox = null;
	}

	@Override
	public void processPages(PDPageTree pages) throws IOException {
		for (PDPage page : pages) {
            currentPageNo++;
            if (page.hasContents()) {
				try {
					processPage(page);
				} catch (IOException e) {
					// TODO: awallace this comes from missing Japan1-7
					// see https://issues.apache.org/jira/browse/PDFBOX-4683
					System.out.println("processPage failure: " + e.getMessage());
				}
			}
		}
	}

	@Override
	public void writeParagraphStart() {
		this.currentTextBox = new TextBox();
		this.currentTextBox.setDocument(this.document);
	}

	private List<TreeSet<TextToken>> getAllTokens() {
		return this.allTokens;
	}

	public synchronized TreeSet<TextToken> getAllTokensForPage(int page) {
		return (TreeSet<TextToken>) this.allTokens.get(page).clone();

	}

	private List<TreeSet<TextBox>> getAllBoxes() {
		return this.allTextBoxes;
	}

	public synchronized TreeSet<TextBox> getAllBoxesForPage(int page) {
		return (TreeSet<TextBox>) this.allTextBoxes.get(page).clone();

	}

	/**
	 * Extract text positions and words from the PDF document.
	 */
	@Override
	public void writeString(String string, List<TextPosition> textPositions) throws IOException {

		StringBuilder unicodeString = new StringBuilder();
		List<TextPosition> goodTextPositions = new ArrayList<TextPosition>();

		for (TextPosition tp : textPositions) {
			if (!badCharPattern.matcher(tp.toString()).replaceAll(" ").trim().isEmpty()) {
				if (!this.isBadCode((int) tp.getUnicode().charAt(0))) {
					goodTextPositions.add(tp);
				}
			}

			unicodeString.append(tp.toString());
		}

		List<Token> tokens = tokenizer.tokenize((unicodeString.toString()));
		if ((tokens.size() >= 2) && (((tokens.get(0).toString().length() == 1)
				|| (SSection.toArabic(tokens.get(0).toString().toUpperCase()) > 0))
				|| (tokens.get(0).toString().length() == 2 && LeverageRatio.isFloat(tokens.get(0).toString())))) {
			Token tok2 = tokens.get(1);
			if (tok2.toString().equals(".") || tok2.toString().equals(")")) {
				Token tok1 = tokens.remove(0);
				tok2.setWordForm(tok1.getWordForm() + tok2.getWordForm());
				tok2.setStartOffset(tok1.getStartOffset());
			}
		}
		tokens = this.fixBrackets(tokens);
		tokens = this.fixSpaces(tokens);

		tpIterator = goodTextPositions.iterator();
		toret = this.getAllTokensForPage(this.getCurrentPageNo() - 1);

		for (int t = 0; t < tokens.size(); t++) {
			currentToken = new TextToken(trailingSpace(tokens, t), this.currentPageNo - 1);
			for (char c : tokens.get(t).toString().toCharArray()) {
				if (!tpIterator.hasNext()) break;

				next = tpIterator.next();
				TextPositionWithPage tpwp = new TextPositionWithPage(next, this.getCurrentPageNo() - 1);
        		TextChar candidate = new TextChar(next, this.getCurrentPageNo() - 1, this.document, this.pageInfoCache, hexColorCodeHashmap.get(tpwp));
				if (!currentToken.canAdd(candidate)) {
					// Don't allow tokens to have different fonts or font sizes
					currentToken.setHasEndingSpace(false);
					if (this.currentTextBox == null)
						this.writeParagraphStart();
					this.currentTextBox.addChild(currentToken);
					toret.add(currentToken);
					if (prevToken != null)
						prevToken.setNextToken(currentToken);
					prevToken = currentToken;
					currentToken = new TextToken(trailingSpace(tokens, t), this.currentPageNo - 1);
				}
				currentToken.addChild(candidate);
			}
			if (!currentToken.getChildren().isEmpty()) {
				toret.add(currentToken);
				if (this.currentTextBox == null)
					this.writeParagraphStart();
				this.currentTextBox.addChild(currentToken);
			}
			if (prevToken != null)
				prevToken.setNextToken(currentToken);
			prevToken = currentToken;
		}
		synchronized (this) {
			this.allTokens.set(this.getCurrentPageNo() - 1, toret);
		}
	}

  public String decimalToHexString(int decimal) {
		StringBuilder r = new StringBuilder();
    	for (int i = 0; i < 6 - Integer.toHexString(decimal).toString().length(); i++) {
        r.append("0");
    	}
			r.append(Integer.toHexString(decimal));
			return r.toString();
	}

	@Override
	public void processTextPosition(TextPosition text) {
		super.processTextPosition(text);
		PDColor pdColor = getGraphicsState().getNonStrokingColor();
		String hex;
		try {
			 // Integer.toHexString(color.getRGB()).substring(2);
			hex = decimalToHexString(pdColor.toRGB());
		} catch (UnsupportedOperationException | IOException e) {
			System.err.println("FAILED TO PARSE COLOR FROM TEXT, DEFAULTING TO BLACK");
			hex = "000000";
			e.printStackTrace();
		}

		TextPositionWithPage tpwp = new TextPositionWithPage(text, this.getCurrentPageNo() - 1);
		hexColorCodeHashmap.put(tpwp, hex);
	}

	/**
	 * Determine if a token has a trailing space (used for SVG cross-compilation)
	 *
	 * @param tokens
	 * @param pos
	 * @return
	 */
	private boolean trailingSpace(List<Token> tokens, int pos) {
		if (tokens == null)
			return false;
		if (pos + 1 > tokens.size())
			return false;
		if (pos + 1 == tokens.size())
			return true; // last word in line has trailing space
		Token ofInterest = tokens.get(pos);
		Token nextToken = tokens.get(pos + 1);
		return ofInterest.getEndOffset() < nextToken.getStartOffset();
	}

	/**
	 * Don't allow tokens to contain Em Space (&emsp;) weird unicode char - not sure
	 * why NLP4J isn't handling this
	 *
	 * @param inToks
	 * @return
	 */
	private List<Token> fixSpaces(List<Token> inToks) {
		List<Token> toret = new ArrayList<Token>();
		for (int i = 0; i < inToks.size(); i++) {
			Token cur = inToks.get(i);
			String[] spt = spacePattern.split(cur.toString());
			if (spt.length == 1) {
				toret.add(cur);
			} else {
				int startOffset = cur.getStartOffset();
				int endOffset = cur.getStartOffset();
				for (String s : spt) {
					endOffset = startOffset + s.length();
					toret.add(new Token(s, startOffset, endOffset));
					startOffset = endOffset + 1;
				}
			}
		}
		return toret;
	}

	private boolean isBadCode(int c) {
		if (c == 0x1680)
			return true;
		if ((c >= 0x2000) && (c <= 0x200F))
			return true;
		if (c == 0x2028)
			return true;
		if (c == 0x2029)
			return true;
		if (c == 0x202F)
			return true;
		if (c == 0x205F)
			return true;
		if (c == 0x3000)
			return true;
		return false;
	}

	/**
	 * Proper handling of Roman Numerals in paranthesis e.g. ["(", "iii", ")"] -->
	 * ["(iii)"]
	 *
	 * @param inToks
	 * @return tokens with roman numerals in one token
	 */
	private List<Token> fixBrackets(List<Token> inToks) {
		List<Token> toret = new ArrayList<Token>();
		if (inToks.size() < 3) {
			return inToks;
		}
		for (int i = 0; i < inToks.size() - 2;) {
			Token t1 = inToks.get(i);
			Token t2 = inToks.get(i + 1);
			Token t3 = inToks.get(i + 2);
			if (!t1.toString().equals("(")) {
				toret.add(t1);
				if (i == inToks.size() - 3) {
					toret.add(t2);
					toret.add(t3);
					break;
				}
				i++;
				continue;
			}
			if (!t3.toString().equals(")")) {
				toret.add(t1);
				if (i == inToks.size() - 3) {
					toret.add(t2);
					toret.add(t3);
					break;
				}
				i++;
				continue;
			}
			boolean isRoman = true;
			for (Character c : t2.toString().toCharArray()) {
				if ((c != 'x') && (c != 'i') && (c != 'v')) {
					isRoman = false;
					break;
				}
			}
			if (!isRoman) {
				toret.add(t1);
				if (i == inToks.size() - 3) {
					toret.add(t2);
					toret.add(t3);
					break;
				}
				i++;
				continue;
			}
			Token newTok = new Token((t1.toString() + t2.toString() + t3.toString()), t1.getStartOffset(),
					t3.getEndOffset());
			toret.add(newTok);
			i += 3;
		}
		return toret;
	}
}
