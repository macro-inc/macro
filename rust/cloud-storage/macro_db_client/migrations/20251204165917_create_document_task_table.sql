-- Add migration script here

CREATE TABLE "document_task"
(
    "document_id" TEXT NOT NULL,

    CONSTRAINT "document_task_pkey" PRIMARY KEY ("document_id"),
    CONSTRAINT "document_task_document_id_fkey" FOREIGN KEY ("document_id") 
        REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
