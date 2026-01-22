-- Create a simple key-value table for storing ID mappings
-- Used for mapping tool IDs to document IDs (e.g., code execution files)

CREATE TABLE "IdMapping"
(
    "sourceId"  TEXT         NOT NULL,
    "targetId"  TEXT         NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdMapping_pkey" PRIMARY KEY ("sourceId")
);

-- Index for looking up by target ID if needed
CREATE INDEX "IdMapping_targetId_idx" ON "IdMapping" ("targetId");
