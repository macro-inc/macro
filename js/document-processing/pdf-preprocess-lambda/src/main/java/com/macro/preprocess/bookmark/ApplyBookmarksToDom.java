package com.macro.preprocess.bookmark;

import java.util.HashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;

import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.common.PDRectangle;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDDocumentOutline;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineItem;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.outline.PDOutlineNode;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.destination.PDDestination;
import org.apache.pdfbox.pdmodel.interactive.documentnavigation.destination.PDPageXYZDestination;

import com.macro.preprocess.component.logical.SSection;
import com.macro.preprocess.parse.PDFDOM;

public class ApplyBookmarksToDom {

	public static void apply(PDDocument document, PDFDOM dom) {
		PDDocumentOutline outline = document.getDocumentCatalog().getDocumentOutline();
		if (outline == null || !outline.hasChildren()) {
			return;
		}
		Map<Integer, List<PDOutlineItem>> destinationsByPage = new HashMap<Integer, List<PDOutlineItem>>();
		addDestinations(outline, destinationsByPage);

		for (SSection section : dom.getAllSections()) {
			addBookmarkInfo(document, section, destinationsByPage);
		}
	}

	private static void addBookmarkInfo(PDDocument document, SSection section,
			Map<Integer, List<PDOutlineItem>> destinationsByPage) {
		int calculatedTop = getCalculatedTop(document, section);
		int pageNum = section.getStartPage();
		if (destinationsByPage.containsKey(pageNum)) {
			for (PDOutlineItem item : destinationsByPage.get(pageNum)) {
				if (isCorrespondingBookmark(calculatedTop, item)) {
					section.showBookmark = true;
					if (item.getTitle().length() > 0) {
						section.bookmarkTitle = item.getTitle();
						return;
					}
				}
			}
		}
		section.showBookmark = false;
	}

	private static Integer getCalculatedTop(PDDocument document, SSection section) {
		float y;
		if (section.getSectionNumber() != null) {
			y = section.getSectionNumber().getY();
		} else if (section.getSectionTitle() != null && (!section.getSectionTitle().isEmpty())) {
			y = section.getSectionTitle().first().getY();
		} else {
			y = 0;
		}
		PDPage page = document.getPage(section.getStartPage());
		PDRectangle trimBox = page.getTrimBox();
		float pageHeight = trimBox.getHeight();
		int calculatedTop = (int) (pageHeight - y);
		return calculatedTop;
	}

	private static boolean isCorrespondingBookmark(int calculatedTop, PDOutlineItem item) {
		try {
			PDDestination destination = item.getDestination();
			if (destination instanceof PDPageXYZDestination) {
				PDPageXYZDestination xyzDestination = (PDPageXYZDestination) destination;
				int top = xyzDestination.getTop();
				if (Math.abs(top - calculatedTop) <= 1) {
					return true;
				}
			}
		} catch (Exception e) {
		}
		return false;
	}

	private static void addDestinations(PDOutlineNode node, Map<Integer, List<PDOutlineItem>> destinationsByPage) {
		if (node instanceof PDOutlineItem) {
			PDOutlineItem item = (PDOutlineItem) node;
			try {
				PDDestination destination = item.getDestination();
				if (destination instanceof PDPageXYZDestination) {
					PDPageXYZDestination xyzDestination = (PDPageXYZDestination) destination;
					int pageNum = xyzDestination.getPageNumber();
					if (destinationsByPage.containsKey(pageNum)) {
						destinationsByPage.get(pageNum).add(item);
					} else {
						List<PDOutlineItem> items = new LinkedList<PDOutlineItem>();
						items.add(item);
						destinationsByPage.put(pageNum, items);
					}
				}
			} catch (Exception e) {
			}
		}
		if (node.hasChildren()) {
			for (PDOutlineItem outlineItem : node.children()) {
				addDestinations(outlineItem, destinationsByPage);
			}
		}
	}
}
