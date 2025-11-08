package com.macro.preprocess.parse;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.util.TreeSet;
import org.apache.pdfbox.pdmodel.PDDocument;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextToken;
import org.apache.pdfbox.pdmodel.PDPage;

public class ExtractPhysicalWrapper {

	private final PDDocument document;
	PageInfoCache pageInfoCache;
	ExtractPhysical ep;

	public ExtractPhysicalWrapper(PDDocument document) throws IOException {
		// NUM_THREADS should be no more than processors - 1, and necessarily must be at
		// least 1.
		this.document = document;
		this.pageInfoCache = new PageInfoCache(document);
		this.ep = new ExtractPhysical(this.document, this.pageInfoCache);

	}

	public void runExtractors() {
		try {
			this.ep.writeText(this.document, new OutputStreamWriter(new ByteArrayOutputStream()));
		} catch (IOException e) {
			e.printStackTrace();
		}
	}

	/**
	 * @return the max page number among all running threads of the ExtractPhysicals
	 */
	public int getCurrentPageNo() {
		return this.ep.getCurrentPageNo();
	}

	public TreeSet<TextToken> getAllTokensForPage(int page) {
		return this.ep.getAllTokensForPage(page);
	}

	public TreeSet<TextBox> getAllBoxesForPage(int page) {
		return this.ep.getAllBoxesForPage(page);
	}

	public int getNumberOfPages() {
		return this.document.getNumberOfPages();
	}

	public PDPage getPDPage(int pageNum) {
		return this.pageInfoCache.getPage(pageNum);
	}

	public float getPageWidth(int pageNum) {
		return this.pageInfoCache.getPageWidth(pageNum);
	}

	public float getPageHeight(int pageNum) {
		return this.pageInfoCache.getPageHeight(pageNum);
	}

	public int getModeCharSize() {
		return this.ep.modeCharSize;
	}
}
