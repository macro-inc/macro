package com.macro.preprocess.bookmark;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDDocumentOutline;
import org.json.JSONObject;

public class BookmarkState extends JSONObject {
	
	private static String BookmarkedKey = "hasBookmarks";
	private static String CoParseBookmarkedKey = "isCoParseBookmarked";
	private static String ShouldAskToBookmarkKey = "shouldAskToBookmark";
	
	public BookmarkState(PDDocument document) {
		super();
		boolean isBookmarked = hasBookmarks(document);
		boolean isCoParseBookmarked = isCoParseBookmarked(document);
		boolean shouldAskToBookmark = shouldAskToBookmark(document);
		
		this.put(BookmarkedKey, isBookmarked);
		this.put(CoParseBookmarkedKey, isCoParseBookmarked);
		this.put(ShouldAskToBookmarkKey, shouldAskToBookmark);
	}
	
	// ----------- PDFBox Metadata Helper Functions -----------
	
	public static boolean hasBookmarks(PDDocument document) {
		PDDocumentOutline outline = document.getDocumentCatalog().getDocumentOutline();
		return outline != null && outline.hasChildren();
	}
	
	public static void setIsCoParseBookmarked(PDDocument document, boolean isCoParseBookmarked) {
        document.getDocumentInformation().setCustomMetadataValue(CoParseBookmarkedKey, Boolean.toString(isCoParseBookmarked));
	}
	
	public static boolean isCoParseBookmarked(PDDocument document) {
		String value = document.getDocumentInformation().getCustomMetadataValue(CoParseBookmarkedKey);
		return value != null && Boolean.getBoolean(value);
	}
	
	public static void setShouldAskToBookmark(PDDocument document, boolean shouldAskToBookmark) {
        document.getDocumentInformation().setCustomMetadataValue(ShouldAskToBookmarkKey, Boolean.toString(shouldAskToBookmark));
	}
	
	public static boolean shouldAskToBookmark(PDDocument document) {
		// TRUE if metadata value is not set or if value is set to true
		String value = document.getDocumentInformation().getCustomMetadataValue(ShouldAskToBookmarkKey);
		return value == null || Boolean.getBoolean(value);
	}
}
