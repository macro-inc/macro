/**
 * Utility functions for Loro Mirror core
 */

import { Container, ContainerID, ContainerType, LoroDoc } from "loro-crdt";
import {
    LoroListSchema,
    LoroMapSchema,
    LoroMovableListSchema,
    LoroTextSchemaType,
    SchemaType,
} from "../schema";
import { Change, InferContainerOptions } from "./mirror";

/**
 * Check if a value is an object
 */
export function isObject(value: unknown): value is Record<string, any> {
    return (
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value) &&
        !(value instanceof Date) &&
        !(value instanceof RegExp) &&
        !(value instanceof Function)
    );
}

/**
 * Performs a deep equality check between two values
 */
export function deepEqual(a: unknown, b: unknown): boolean {
    // Check if both values are the same reference or primitive equality
    if (a === b) return true;

    // If either value is null or not an object or function, they can't be deeply equal unless they were strictly equal (checked above)
    if (
        a === null ||
        b === null ||
        (typeof a !== "object" && typeof a !== "function") ||
        (typeof b !== "object" && typeof b !== "function")
    ) {
        return false;
    }

    // Handle arrays
    if (Array.isArray(a) && Array.isArray(b)) {
        if (a.length !== b.length) return false;

        for (let i = 0; i < a.length; i++) {
            if (!deepEqual(a[i], b[i])) return false;
        }

        return true;
    }
    // Handle Date objects
    if (a instanceof Date && b instanceof Date) {
        return a.getTime() === b.getTime();
    }

    // Handle RegExp objects
    if (a instanceof RegExp && b instanceof RegExp) {
        return a.toString() === b.toString();
    }

    // Handle other objects
    if (!Array.isArray(a) && !Array.isArray(b)) {
        const keysA = Object.keys(a as object);
        const keysB = Object.keys(b as object);

        if (keysA.length !== keysB.length) return false;

        for (const key of keysA) {
            if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
            if (
                !deepEqual(
                    (a as Record<string, unknown>)[key],
                    (b as Record<string, unknown>)[key],
                )
            )
                return false;
        }

        return true;
    }

    return false;
}

/**
 * Get a value from a nested object using a path array
 */
export function getPathValue(obj: Record<string, any>, path: string[]): any {
    let current = obj;

    for (let i = 0; i < path.length; i++) {
        if (current === undefined || current === null) return undefined;

        const key = path[i];
        current = current[key];
    }

    return current;
}

/**
 * Set a value in a nested object using a path array
 * Note: This modifies the object directly (intended for use with Immer)
 */
export function setPathValue(
    obj: Record<string, any>,
    path: string[],
    value: any,
): void {
    if (path.length === 0) return;

    let current = obj;
    const lastIndex = path.length - 1;

    for (let i = 0; i < lastIndex; i++) {
        const key = path[i];

        // Create nested objects if they don't exist
        if (
            current[key] === undefined ||
            current[key] === null ||
            typeof current[key] !== "object"
        ) {
            current[key] = {};
        }

        current = current[key];
    }

    // Set the value at the final path
    const lastKey = path[lastIndex];
    if (value === undefined) {
        delete current[lastKey];
    } else {
        current[lastKey] = value;
    }
}

type ContainerValue = {
    cid: string;
    value: any;
};

export function valueIsContainer(value: any): value is ContainerValue {
    return (
        value && typeof value === "object" && "cid" in value && "value" in value
    );
}

export function valueIsContainerOfType(
    value: any,
    containerType: string,
): value is ContainerValue {
    return valueIsContainer(value) && value.cid.endsWith(containerType);
}

export function containerIdToContainerType(
    containerId: ContainerID,
): ContainerType | undefined {
    if (containerId.endsWith(":Map")) {
        return "Map";
    } else if (containerId.endsWith(":List")) {
        return "List";
    } else if (containerId.endsWith(":Text")) {
        return "Text";
    } else if (containerId.endsWith(":MovableList")) {
        return "MovableList";
    } else {
        return undefined;
    }
}

export function getRootContainerByType(
    doc: LoroDoc,
    key: string,
    type: ContainerType,
): Container {
    if (type === "Text") {
        return doc.getText(key);
    } else if (type === "List") {
        return doc.getList(key);
    } else if (type === "MovableList") {
        return doc.getMovableList(key);
    } else if (type === "Map") {
        return doc.getMap(key);
    } else {
        throw new Error();
    }
}

/* Insert a child change to a map */
export function insertChildToMap(
    containerId: ContainerID | "",
    key: string,
    value: unknown,
): Change {
    if (isObject(value)) {
        return {
            container: containerId,
            key,
            value: value,
            kind: "insert-container",
            childContainerType: "Map",
        };
    } else if (Array.isArray(value)) {
        return {
            container: containerId,
            key,
            value: value,
            kind: "insert-container",
            childContainerType: "List",
        };
    } else {
        return {
            container: containerId,
            key,
            value: value,
            kind: "insert",
        };
    }
}

/* Try to update a change to insert a container */
export function tryUpdateToInsertContainer(
    change: Change,
    toUpdate: boolean,
    schema: SchemaType | undefined,
): Change {
    if (!toUpdate) {
        return change;
    }

    if (change.kind !== "insert") {
        return change;
    }

    let containerType = schema
        ? (schemaToContainerType(schema) ?? tryInferContainerType(change.value))
        : undefined;

    switch (containerType) {
        case "Map":
            change.kind = "insert-container";
            change.childContainerType = "Map";
            break;
        case "List":
            change.kind = "insert-container";
            change.childContainerType = "List";
            break;
        case "Text":
            change.kind = "insert-container";
            change.childContainerType = "Text";
            break;
        case "Counter":
            change.kind = "insert-container";
            change.childContainerType = "Counter";
            break;
    }

    return change;
}

/* Get container type from schema */
export function schemaToContainerType<S extends SchemaType>(
    schema: S,
): S extends LoroMapSchema<any>
    ? "Map"
    : S extends LoroListSchema<any>
      ? "List"
      : S extends LoroMovableListSchema<any>
        ? "MovableList"
        : S extends LoroTextSchemaType
          ? "Text"
          : undefined {
    const containerType = schema.getContainerType();
    return containerType as any;
}

/* Try to infer container type from value */
export function tryInferContainerType(
    value: unknown,
    defaults?: InferContainerOptions,
): ContainerType | undefined {
    if (isObject(value)) {
        return "Map";
    } else if (Array.isArray(value)) {
        if (defaults?.defaultMovableList) {
            return "MovableList";
        }
        return "List";
    } else if (typeof value === "string") {
        if (defaults?.defaultLoroText) {
            return "Text";
        } else {
            return;
        }
    }
}

/* Check if value is of a given container type */
export function isValueOfContainerType(
    containerType: ContainerType,
    value: any,
): boolean {
    switch (containerType) {
        case "MovableList":
        case "List":
        case "Map":
            return typeof value === "object" && value !== null;
        case "Text":
            return typeof value === "string" && value !== null;
        default:
            return false;
    }
}

/* Infer container type from value */
export function inferContainerTypeFromValue(
    value: unknown,
    defaults?: InferContainerOptions,
): "loro-map" | "loro-list" | "loro-text" | "loro-movable-list" | undefined {
    if (isObject(value)) {
        return "loro-map";
    } else if (Array.isArray(value)) {
        if (defaults?.defaultMovableList) {
            return "loro-movable-list";
        }
        return "loro-list";
    } else if (typeof value === "string") {
        if (defaults?.defaultLoroText) {
            return "loro-text";
        }
    } else {
        return;
    }
}

export type ObjectLike = Record<string, unknown>;
export type ArrayLike = Array<unknown>;

/* Check if value is an object */
export function isObjectLike(value: unknown): value is ObjectLike {
    return typeof value === "object";
}

/* Check if value is an array */
export function isArrayLike(value: unknown): value is ArrayLike {
    return Array.isArray(value);
}

/* Check if value is a string */
export function isStringLike(value: unknown): value is string {
    return typeof value === "string";
}

/* Type guard to ensure state and schema are of the correct type */
export function isStateAndSchemaOfType<
    S extends ObjectLike | ArrayLike | string,
    T extends SchemaType,
>(
    values: {
        oldState: unknown;
        newState: unknown;
        schema: SchemaType | undefined;
    },
    stateGuard: (value: unknown) => value is S,
    schemaGuard: (schema: SchemaType) => schema is T,
): values is { oldState: S; newState: S; schema: T | undefined } {
    return (
        stateGuard(values.oldState) &&
        stateGuard(values.newState) &&
        (!values.schema || schemaGuard(values.schema))
    );
}
