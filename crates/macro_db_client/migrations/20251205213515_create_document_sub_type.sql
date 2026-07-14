-- Create the document sub type enum
CREATE TYPE document_sub_type_value AS ENUM ('task');

-- Create the document_sub_type table
CREATE TABLE "document_sub_type"
(
    "document_id" TEXT NOT NULL,
    "sub_type" document_sub_type_value NOT NULL,

    CONSTRAINT "document_sub_type_pkey" PRIMARY KEY ("document_id"),
    CONSTRAINT "document_sub_type_document_id_fkey" FOREIGN KEY ("document_id") 
        REFERENCES "Document" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
