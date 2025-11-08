import { z } from "zod";

export const errorResponse = z.object({
  error: z.literal(true),
  message: z.string()
});

export const standardErrorResponses = {
  400: {
    description: "Invalid request parameters",
    content: {
      "application/json": {
        schema: errorResponse,
      },
    },
  },
  401: {
    description: "Unauthorized - Invalid or missing authentication",
    content: {
      "application/json": {
        schema: errorResponse,
      },
    },
  },
  404: {
    description: "Resource not found",
    content: {
      "application/json": {
        schema: errorResponse,
      },
    },
  },
  500: {
    description: "Internal server error",
    content: {
      "application/json": {
        schema: errorResponse,
      },
    },
  },
  503: {
    description: "Service unavailable",
    content: {
      "application/json": {
        schema: errorResponse,
      },
    },
  },
};

export const docIdParam = z.object({
  docId: z.string().min(1, "Document ID is required"),
});

export const searchableNodeSchema = z.object({
  nodeId: z.string(),
  content: z.string(),
  rawContent: z.string()
});

export const cognitionNodeSchema = z.object({
  nodeId: z.string(),
  content: z.string(),
  rawContent: z.string(),
  type: z.string()
});
