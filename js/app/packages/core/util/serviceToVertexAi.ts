import { z } from 'zod';
import type { Access, Svc } from '../service';

export enum SchemaType {
  STRING = 'STRING',
  NUMBER = 'NUMBER',
  INTEGER = 'INTEGER',
  BOOLEAN = 'BOOLEAN',
  ARRAY = 'ARRAY',
  OBJECT = 'OBJECT',
}

export interface Schema {
  type?: SchemaType;
  format?: string;
  description?: string;
  nullable?: boolean;
  items?: Schema;
  enum?: string[];
  properties?: { [k: string]: Schema };
  required?: string[];
  example?: unknown;
}

export function convertSvcToVertexAI(
  svc: Svc<any, any, any>
): Record<string, any> {
  const result: Record<string, any> = {};

  if (!hasAIAccess(svc.state.def.access)) {
    return result;
  }

  for (const [fnName, fnDef] of Object.entries(svc.state.functions)) {
    if (!hasAIAccess(fnDef.access)) {
      continue;
    }

    result[fnName] = {
      name: fnName,
      description: fnDef.description,
      parameters: convertZodToVertexSchema(fnDef.args),
    };

    if (fnDef.result) {
      result[fnName].returns = convertZodToVertexSchema(fnDef.result);
    }

    if (fnDef.modifies) {
      result[fnName].modifies = true;
    }
  }

  for (const [subServiceName, subService] of Object.entries(
    svc.state.services
  )) {
    const subServiceResult = convertSvcToVertexAI(subService);
    if (Object.keys(subServiceResult).length > 0) {
      result[subServiceName] = subServiceResult;
    }
  }

  return result;
}

function convertZodToVertexSchema(zodSchema?: z.ZodTypeAny): Schema {
  if (!zodSchema) return {};

  if (zodSchema instanceof z.ZodObject) {
    const properties: { [k: string]: Schema } = {};
    const required: string[] = [];

    for (const [key, value] of Object.entries<z.ZodTypeAny>(zodSchema.shape)) {
      const fieldSchema = zodTypeToVertexSchema(value);
      properties[key] = fieldSchema;

      if (!(value instanceof z.ZodOptional) && !isNullable(value)) {
        required.push(key);
      }
    }

    return {
      type: SchemaType.OBJECT,
      properties,
      required: required.length > 0 ? required : undefined,
    };
  }

  return zodTypeToVertexSchema(zodSchema);
}

function zodTypeToVertexSchema(zodType: z.ZodTypeAny): Schema {
  let schema: Schema = {
    type: getVertexSchemaType(zodType),
  };

  if (zodType.description) {
    schema.description = zodType.description;
  }

  if (zodType instanceof z.ZodEnum) {
    schema.enum = zodType.options;
  } else if (zodType instanceof z.ZodArray) {
    schema.items = zodTypeToVertexSchema(zodType.element);
  } else if (zodType instanceof z.ZodObject) {
    const { properties, required } = convertZodToVertexSchema(
      zodType
    ) as Schema;
    schema.properties = properties;
    schema.required = required;
  } else if (zodType instanceof z.ZodUnion) {
    schema.type = SchemaType.STRING;
    schema.description = 'Union of multiple types';
  } else if (zodType instanceof z.ZodOptional) {
    schema = zodTypeToVertexSchema(zodType.unwrap());
    schema.nullable = true;
  } else if (zodType instanceof z.ZodNullable) {
    schema = zodTypeToVertexSchema(zodType.unwrap());
    schema.nullable = true;
  }

  return schema;
}

function getVertexSchemaType(zodType: z.ZodTypeAny): SchemaType {
  if (zodType instanceof z.ZodString) return SchemaType.STRING;
  if (zodType instanceof z.ZodNumber) return SchemaType.NUMBER;
  if (zodType instanceof z.ZodBoolean) return SchemaType.BOOLEAN;
  if (zodType instanceof z.ZodArray) return SchemaType.ARRAY;
  if (zodType instanceof z.ZodObject) return SchemaType.OBJECT;
  if (zodType instanceof z.ZodEnum) return SchemaType.STRING;
  if (zodType instanceof z.ZodOptional)
    return getVertexSchemaType(zodType.unwrap());
  if (zodType instanceof z.ZodNullable)
    return getVertexSchemaType(zodType.unwrap());

  throw new Error(`Unhandled Zod type: ${zodType.constructor.name}`);
}

function isNullable(zodType: z.ZodTypeAny): boolean {
  return zodType instanceof z.ZodNullable || zodType.isNullable();
}

function hasAIAccess(access?: Access): boolean {
  if (!access) return true;
  if ('exclude' in access) {
    return !access.exclude?.includes('ai');
  }
  if ('only' in access) {
    return access.only?.includes('ai') ?? false;
  }
  return true;
}
