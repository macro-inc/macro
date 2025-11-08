package com.macro.preprocess.component;

import java.util.TreeSet;

import org.apache.pdfbox.pdmodel.PDDocument;

/**
 * Parent of all physical component. A physical component is something that can
 * be seen on the PDF i.e. has a valid coordinate. Physical components' tree
 * structure is dependent on positioning and not logical features. Unlike
 * logical components, physical components only exist within 1 page and thus can
 * be parsed in parallel. Examples include text boxes, characters, images, etc.
 */
public abstract class PhysicalComponent implements Comparable<PhysicalComponent> {

	protected PDDocument document;
	protected int pageNum;
	protected float x;
	protected float y;
	protected float width;
	protected float height;
	protected PhysicalComponent parent;
	private TreeSet<PhysicalComponent> children;
	protected boolean permitsChildren;
	protected LogicalComponent logicalOwner;
	public static final float SPACING_TOLERANCE = 3f;
	public static final float DROP_TOLERANCE = -5.5f;

	public PhysicalComponent() {
		children = new TreeSet<PhysicalComponent>();
		this.permitsChildren = true;
	}

	public PDDocument getDocument() {
		return document;
	}

	public void setDocument(PDDocument document) {
		assert (this.document == null);
		this.document = document;
	}

	public float getX() {
		return x;
	}

	public float getY() {
		return y;
	}

	public float getWidth() {
		return width;
	}

	public float getHeight() {
		return height;
	}

	public PhysicalComponent getParent() {
		return parent;
	}

	public TreeSet<PhysicalComponent> getChildren() {
		if (!this.permitsChildren)
			return null;
		return children;
	}

	public boolean getPermitsChildren() {
		return permitsChildren;
	}

	public LogicalComponent getLogicalOwner() {
		return logicalOwner;
	}

	public void setLogicalOwner(LogicalComponent logicalOwner) {
		this.logicalOwner = logicalOwner;
	}

	public int getPageNum() {
		return pageNum;
	}

	public void setPageNum(int pageNum) {
		this.pageNum = pageNum;
	}

	public void setX(float x) {
		this.x = x;
	}

	public void setY(float y) {
		this.y = y;
	}

	public void setWidth(float width) {
		this.width = width;
	}

	public void setHeight(float height) {
		this.height = height;
	}

	public void setParent(PhysicalComponent parent) {
		this.parent = parent;
		synchronized (this.children) {
			parent.children.add(this);
		}
	}

	public void addChild(PhysicalComponent child) {
		synchronized (this.children) {
			this.children.add(child);
		}
		child.parent = this;
	}

	public void setPermitsChildren(boolean permitsChildren) {
		this.permitsChildren = permitsChildren;
	}

	/**
	 * Preliminary naive ordering assuming single-column layout.
	 */
	@Override
	public int compareTo(PhysicalComponent other) {
		if (this.getPageNum() < other.getPageNum()) {
			return -1;
		} else if (this.getPageNum() > other.getPageNum()) {
			return 1;
		}
		// tolerance for char heights
		else if ((this.getX() < other.getX()) && (Math.abs(this.getY() - other.getY()) < SPACING_TOLERANCE)) {
			return -1;
		} else if ((this.getX() > other.getX()) && (Math.abs(this.getY() - other.getY()) < SPACING_TOLERANCE)) {
			return 1;
		} else if (this.getY() < other.getY()) {
			return -1;
		} else if ((this.getX() == other.getX()) && (this.getY() == other.getY())) {
			return 0;
		}
		return 1;
	}

	/**
	 * Assume square bounds, this can be overridden in subclasses that don't have
	 * square bounding boxes.
	 */
	public boolean contains(float tgtX, float tgtY) {
		if ((tgtY >= this.getY() + this.getHeight()) || (tgtY < this.getY()) || (tgtX < this.getX())
				|| (tgtX >= this.getX() + this.getWidth()))
			return false;
		return true;
	}

	/**
	 * Assume square bounds, this can be overridden in subclasses that don't have
	 * square bounding boxes.
	 */
	public boolean overlaps(PhysicalComponent other) {
		return this.overlaps(other, DROP_TOLERANCE);
	}

	public boolean overlaps(PhysicalComponent other, float dropTolerance) {
		// Cache because we don't know runtime of getZ methods in subclasses
		float oWidth = other.getWidth();
		float oHeight = other.getHeight();
		float oX = other.getX();
		float oY = other.getY();

		float tWidth = this.getWidth();
		float tHeight = this.getHeight();
		float tX = this.getX();
		float tY = this.getY();

		if (tX > oX + oWidth || oX > tX + tWidth) {
			return false;
		}

		if (tY + tHeight < oY + dropTolerance || oY + oHeight < tY + dropTolerance) {
			return false;
		}

		return true;
	}

	public boolean isContainedBy(float ULX, float ULY, float URX, float URY, float LLX, float LLY, float LRX,
			float LRY) {
		/*
		 * if (!((this.getX() >= ULX - 5f) && (this.getY() >= ULY - 5f) && (this.getX()
		 * <= URX + 5f) && (this.getY() <= LRY + 5f))) { return false; }
		 */
		float overlapArea = Math.max(0, Math.min(this.getX() + this.getWidth(), LRX) - Math.max(this.getX(), ULX))
				* Math.max(0, Math.min(this.getY() + this.getHeight(), LRY) - Math.max(this.getY(), URY));
		float thisArea = this.getWidth() * this.getHeight();
		return overlapArea / (thisArea + 1e-8) > .3;
	}
}
