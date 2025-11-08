package com.macro.preprocess;

import java.util.TreeSet;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDDocumentInformation;

import com.macro.preprocess.bookmark.ApplyBookmarksToDom;
import com.macro.preprocess.bookmark.BookmarkState;
import com.macro.preprocess.component.PhysicalComponent;
import com.macro.preprocess.component.logical.ai.DocumentData;
import com.macro.preprocess.component.logical.ai.PageData;
import com.macro.preprocess.component.logical.ai.TextBoxData;
import com.macro.preprocess.component.logical.ai.TextTokenData;
import com.macro.preprocess.component.physical.TextBox;
import com.macro.preprocess.component.physical.TextToken;
import com.macro.preprocess.parse.AnomalyDetector;
import com.macro.preprocess.parse.ExtractLogical;
import com.macro.preprocess.parse.ExtractPhysicalWrapper;
import com.macro.preprocess.parse.PDF2Overlay;
import com.macro.preprocess.parse.PDFDOM;
import com.macro.preprocess.web.Bundler;
import com.macro.preprocess.web.GzipUtil;

public class ProcessPDF {

	private static class AnalyzeResult {
		ExtractPhysicalWrapper ep;
		ExtractLogical eLogical;
		PDFDOM dom;
		PDF2Overlay overlay;

		public AnalyzeResult(ExtractPhysicalWrapper ep, ExtractLogical eLogical, PDFDOM dom, PDF2Overlay overlay) {
			this.ep = ep;
			this.eLogical = eLogical;
			this.dom = dom;
			this.overlay = overlay;
		}
	}

	public static String process(PDDocument document, boolean logTimes, boolean includeDocumentData, final Logger logger)
			throws Exception {
		long startTime;
		long endTime;
		AnomalyDetector ad = new AnomalyDetector();

		String storedCoParseNotepad = document.getDocumentInformation().getCustomMetadataValue("storedCoParseNotepad");
		if (storedCoParseNotepad == null) {
			storedCoParseNotepad = "";
		} else {
			storedCoParseNotepad = GzipUtil.unzip(storedCoParseNotepad);
		}

		String storedPinnedTermsNames = document.getDocumentInformation().getCustomMetadataValue("storedPinnedTermsNames");
		if (storedPinnedTermsNames == null) {
			storedPinnedTermsNames = "";
		} else {
			storedPinnedTermsNames = GzipUtil.unzip(storedPinnedTermsNames);
		}

		PDDocumentInformation pdd = document.getDocumentInformation();
		String title = pdd.getTitle();
		startTime = System.currentTimeMillis();

		endTime = System.currentTimeMillis();
		if (logTimes) {
			System.out.println("Annotation extraction time: " + (endTime - startTime));
		}
		AnalyzeResult result = analyze(document, ad, logTimes);
		BookmarkState bookmarkState = new BookmarkState(document);

		// COLLECT OUTPUTS FOR BUNDLING
		String sectionXML = result.dom.getSectionXML();
		String definitionXML = result.dom.getDefinitionXML();
		Bundler.Builder bundlerBuilder = new Bundler.Builder()
				.setTitle(title)
				.setToc(sectionXML)
				.setDefs(definitionXML)
				.setBookmarkState(bookmarkState)
				.setPages(result.overlay.getPages())
				.setStoredCoParseNotepad(storedCoParseNotepad)
				.setAnomalies(ad.toJSON())
				.setStoredPinnedTermsNames(storedPinnedTermsNames);

		if (includeDocumentData) {
			DocumentData.Builder documentDataBuilder = new DocumentData.Builder();
			int numPages = document.getNumberOfPages();
			documentDataBuilder.setNumPages(numPages);
			for (int pageNumber = 0; pageNumber < numPages; pageNumber++) {
				PageData.Builder pageDataBuilder = new PageData.Builder();
				pageDataBuilder.setPageNum(pageNumber);
				pageDataBuilder.setPageHeight(result.ep.getPageHeight(pageNumber));
				TreeSet<TextBox> boxes = result.ep.getAllBoxesForPage(pageNumber);
				for (TextBox box : boxes) {
					TextBoxData.Builder textBoxDataBuilder = new TextBoxData.Builder();
					textBoxDataBuilder.setText(box.getText());
					textBoxDataBuilder.setY(box.getY());
					for (PhysicalComponent child : box.getChildren()) {
						TextToken token = (TextToken) child;
						TextTokenData.Builder textTokenDataBuilder = new TextTokenData.Builder();
						textTokenDataBuilder.setText(token.toString());
						textTokenDataBuilder.setY(token.getY());
						textBoxDataBuilder.addTextTokenData(textTokenDataBuilder.build());
					}
					pageDataBuilder.addTextBoxData(textBoxDataBuilder.build());
				}
				documentDataBuilder.addPageData(pageDataBuilder.build());
			}
			bundlerBuilder.setDocumentData(documentDataBuilder.build().toJson());
		}

		return bundlerBuilder.build().get();
	}

	public static PDFDOM getDom(PDDocument document, boolean logTimes) {
		try {
			AnomalyDetector ad = new AnomalyDetector();
			AnalyzeResult result = analyze(document, ad, logTimes);
			return result.dom;
		} catch (Exception e) {
			System.err.printf("Failed to analyze PDDocument:", e.getMessage());
			e.printStackTrace();
		}
		return null;
	}

	private static AnalyzeResult analyze(PDDocument document, AnomalyDetector ad, boolean logTimes) throws Exception {
		long one;
		long two;

		// EXTRACT PHYSICAL COMPONENTS
		ExtractPhysicalWrapper epw = new ExtractPhysicalWrapper(document);
		epw.runExtractors();

		one = System.currentTimeMillis();
		// EXTRACT LOGICAL COMPONENTS

		ExtractLogical eLogical = new ExtractLogical(epw, ad);
		PDFDOM dom = eLogical.extract();
		two = System.currentTimeMillis();
		if (logTimes) {
			System.out.println("Logical Extraction Time: " + (two - one));
		}

		PDF2Overlay overlay = new PDF2Overlay(eLogical);

		// Apply bookmarks to DOM sections
		if (BookmarkState.isCoParseBookmarked(document)) {
			ApplyBookmarksToDom.apply(document, dom);
		}

		return new AnalyzeResult(epw, eLogical, dom, overlay);
	}
}
