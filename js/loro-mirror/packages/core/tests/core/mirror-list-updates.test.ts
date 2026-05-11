/**
 * Tests focused on Mirror's efficient list update capabilities
 * These tests demonstrate how the Mirror class optimizes list updates
 * based on whether an idSelector is provided
 */

import { Mirror } from "../../src/core/mirror";
import { LoroDoc, LoroMap } from "loro-crdt";
import { schema } from "../../src/schema";
import { describe, expect, it } from "vitest";

describe("Mirror List Update Optimization", () => {
    // Utility function to wait for sync to complete (three microtasks for better reliability)
    const waitForSync = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    };

    /**
     * Test the behavior when using an idSelector function
     * This should result in efficient updates that only modify changed items
     */
    it("maintains list item identity with idSelector", async () => {
        // Define a schema with an idSelector function for the list
        const todoSchema = schema({
            todos: schema.LoroList(
                schema.LoroMap({
                    id: schema.String({ required: true }),
                    text: schema.String({ required: true }),
                    completed: schema.Boolean({ defaultValue: false }),
                }),
                // This idSelector function allows the Mirror to track items by ID
                (todo) => todo.id,
            ),
        });

        const doc = new LoroDoc();

        // Set up the container structure properly before creating the mirror
        doc.getList("todos");
        doc.commit();

        const mirror = new Mirror({
            doc,
            schema: todoSchema,
        });

        // Initial state with 3 todos
        const initialTodos = [
            { id: "1", text: "Task 1", completed: false },
            { id: "2", text: "Task 2", completed: false },
            { id: "3", text: "Task 3", completed: false },
        ];

        // Set initial state
        mirror.setState({ todos: initialTodos });
        await waitForSync();

        // Verify the initial state
        expect(mirror.getState().todos).toHaveLength(3);
        expect(mirror.getState().todos[0].id).toBe("1");
        expect(mirror.getState().todos[1].id).toBe("2");
        expect(mirror.getState().todos[2].id).toBe("3");

        // Scenario 1: Update a property of a specific todo without changing order
        mirror.setState({
            todos: [
                { id: "1", text: "Task 1", completed: false },
                { id: "2", text: "Task 2 Updated", completed: true }, // Only this item changed
                { id: "3", text: "Task 3", completed: false },
            ],
        });
        doc.commit();

        // Wait for sync to complete
        await waitForSync();
        mirror.sync();
        await waitForSync();

        // Verify that only the specified item was updated
        expect(mirror.getState().todos).toHaveLength(3);
        expect(mirror.getState().todos[0].id).toBe("1");
        expect(mirror.getState().todos[1].id).toBe("2");
        expect(mirror.getState().todos[1].text).toBe("Task 2 Updated");
        expect(mirror.getState().todos[1].completed).toBe(true);
        expect(mirror.getState().todos[2].id).toBe("3");

        // Scenario 2: Reordering items
        mirror.setState({
            todos: [
                { id: "3", text: "Task 3", completed: false },
                { id: "1", text: "Task 1", completed: false },
                { id: "2", text: "Task 2 Updated", completed: true },
            ],
        });
        doc.commit();

        // Wait for sync to complete
        await waitForSync();
        mirror.sync();
        await waitForSync();

        // Verify that items were reordered correctly, maintaining their identity
        expect(mirror.getState().todos).toHaveLength(3);
        expect(mirror.getState().todos[0].id).toBe("3");
        expect(mirror.getState().todos[1].id).toBe("1");
        expect(mirror.getState().todos[2].id).toBe("2");
        expect(mirror.getState().todos[2].text).toBe("Task 2 Updated");
        expect(mirror.getState().todos[2].completed).toBe(true);

        // Scenario 3: Adding a new item
        mirror.setState({
            todos: [
                { id: "3", text: "Task 3", completed: false },
                { id: "1", text: "Task 1", completed: false },
                { id: "2", text: "Task 2 Updated", completed: true },
                { id: "4", text: "Task 4", completed: false }, // New item
            ],
        });
        doc.commit();

        // Wait for sync to complete
        await waitForSync();
        mirror.sync();
        await waitForSync();

        // Verify that a new item was added while maintaining existing items
        expect(mirror.getState().todos).toHaveLength(4);
        expect(mirror.getState().todos[0].id).toBe("3");
        expect(mirror.getState().todos[1].id).toBe("1");
        expect(mirror.getState().todos[2].id).toBe("2");
        expect(mirror.getState().todos[3].id).toBe("4");
        expect(mirror.getState().todos[3].text).toBe("Task 4");

        // Scenario 4: Removing an item
        mirror.setState({
            todos: [
                { id: "3", text: "Task 3", completed: false },
                { id: "1", text: "Task 1", completed: false },
                // Item with id '2' is removed
                { id: "4", text: "Task 4", completed: false },
            ],
        });
        doc.commit();

        // Wait for sync to complete
        await waitForSync();
        mirror.sync();
        await waitForSync();

        // Verify that the specified item was removed while maintaining others
        expect(mirror.getState().todos).toHaveLength(3);
        expect(mirror.getState().todos[0].id).toBe("3");
        expect(mirror.getState().todos[1].id).toBe("1");
        expect(mirror.getState().todos[2].id).toBe("4");
        // Verify that id '2' is no longer in the list
        expect(mirror.getState().todos.find((todo) => todo.id === "2"))
            .toBeUndefined();
    });

    /**
     * Test the behavior when NO idSelector function is provided
     * Without an idSelector, the Mirror falls back to position-based updates
     */
    it("updates by position without idSelector", async () => {
        // Define a schema WITHOUT an idSelector function
        const itemsSchema = schema({
            items: schema.LoroList(
                schema.LoroMap({
                    value: schema.String({ required: true }),
                }),
                // No idSelector provided here
            ),
        });

        const doc = new LoroDoc();

        // Set up the container structure properly before creating the mirror
        const itemsList = doc.getList("items");
        doc.commit();

        // Create map items directly
        const item1 = itemsList.pushContainer(new LoroMap());
        item1.set("value", "Item 1");

        const item2 = itemsList.pushContainer(new LoroMap());
        item2.set("value", "Item 2");

        const item3 = itemsList.pushContainer(new LoroMap());
        item3.set("value", "Item 3");
        doc.commit();

        const mirror = new Mirror({
            doc,
            schema: itemsSchema,
            throwOnValidationError: true,
        });

        // Initial state with 3 items
        const initialItems = [
            { value: "Item 1" },
            { value: "Item 2" },
            { value: "Item 3" },
        ];

        // Set initial state
        mirror.setState({ items: initialItems });
        doc.commit();

        await waitForSync();

        // Verify initial state
        expect(mirror.getState().items).toHaveLength(3);
        expect(mirror.getState().items[0].value).toBe("Item 1");
        expect(mirror.getState().items[1].value).toBe("Item 2");
        expect(mirror.getState().items[2].value).toBe("Item 3");

        // Scenario 1: Update a property of a specific item
        mirror.setState({
            items: [
                { value: "Item 1" },
                { value: "Item 2 Updated" }, // This item changed
                { value: "Item 3" },
            ],
        });
        doc.commit();

        // Wait for sync to complete
        await waitForSync();
        mirror.sync();
        await waitForSync();

        // Verify that the item at position 1 was updated
        expect(mirror.getState().items).toHaveLength(3);
        expect(mirror.getState().items[0].value).toBe("Item 1");
        expect(mirror.getState().items[1].value).toBe("Item 2 Updated");
        expect(mirror.getState().items[2].value).toBe("Item 3");

        // Scenario 2: Reordering items
        mirror.setState({
            items: [
                { value: "Item 3" },
                { value: "Item 1" },
                { value: "Item 2 Updated" },
            ],
        });
        doc.commit();

        // Wait for sync to complete
        await waitForSync();
        mirror.sync();
        await waitForSync();

        // Verify that the items were reordered by position
        expect(mirror.getState().items).toHaveLength(3);
        expect(mirror.getState().items[0].value).toBe("Item 3");
        expect(mirror.getState().items[1].value).toBe("Item 1");
        expect(mirror.getState().items[2].value).toBe("Item 2 Updated");
    });

    /**
     * Test the behavior with nested lists and idSelectors
     */
    it("efficiently updates nested lists with idSelectors", async () => {
        // Define a schema with nested lists, both using idSelectors
        const nestedSchema = schema({
            categories: schema.LoroList(
                schema.LoroMap({
                    id: schema.String({ required: true }),
                    name: schema.String({ required: true }),
                    items: schema.LoroList(
                        schema.LoroMap({
                            id: schema.String({ required: true }),
                            name: schema.String({ required: true }),
                            quantity: schema.Number({ defaultValue: 1 }),
                        }),
                        // ID selector for the nested list
                        (item) => item.id,
                    ),
                }),
                // ID selector for the outer list
                (category) => category.id,
            ),
        });

        const doc = new LoroDoc();

        // Set up the container structure properly before creating the mirror
        doc.getList("categories");
        doc.commit();

        const mirror = new Mirror({
            doc,
            schema: nestedSchema,
        });

        // Initial state with 2 categories, each with 2 items
        const initialState = {
            categories: [
                {
                    id: "cat1",
                    name: "Category 1",
                    items: [
                        { id: "item1", name: "Item 1", quantity: 1 },
                        { id: "item2", name: "Item 2", quantity: 2 },
                    ],
                },
                {
                    id: "cat2",
                    name: "Category 2",
                    items: [
                        { id: "item3", name: "Item 3", quantity: 3 },
                        { id: "item4", name: "Item 4", quantity: 4 },
                    ],
                },
            ],
        };

        // Set initial state
        mirror.setState(initialState);
        doc.commit();

        // Wait for sync to complete
        await waitForSync();
        mirror.sync();
        await waitForSync();

        // Verify initial state
        expect(mirror.getState().categories).toHaveLength(2);
        expect(mirror.getState().categories[0].id).toBe("cat1");
        expect(mirror.getState().categories[0].items).toHaveLength(2);
        expect(mirror.getState().categories[0].items[0].id).toBe("item1");
        expect(mirror.getState().categories[0].items[0].quantity).toBe(1);

        // Scenario: Update a property of a nested item
        mirror.setState({
            categories: [
                {
                    id: "cat1",
                    name: "Category 1",
                    items: [
                        { id: "item1", name: "Item 1", quantity: 10 }, // Updated quantity
                        { id: "item2", name: "Item 2", quantity: 2 },
                    ],
                },
                {
                    id: "cat2",
                    name: "Category 2",
                    items: [
                        { id: "item3", name: "Item 3", quantity: 3 },
                        { id: "item4", name: "Item 4", quantity: 4 },
                    ],
                },
            ],
        });
        doc.commit();

        // Wait for sync to complete
        await waitForSync();
        mirror.sync();
        await waitForSync();

        // Verify that only the nested item's quantity was updated
        expect(mirror.getState().categories[0].items[0].quantity).toBe(10);
        expect(mirror.getState().categories[0].items[1].quantity).toBe(2);

        // Scenario: Add a new nested item
        mirror.setState({
            categories: [
                {
                    id: "cat1",
                    name: "Category 1",
                    items: [
                        { id: "item1", name: "Item 1", quantity: 10 },
                        { id: "item2", name: "Item 2", quantity: 2 },
                        { id: "item5", name: "Item 5", quantity: 5 }, // New item
                    ],
                },
                {
                    id: "cat2",
                    name: "Category 2",
                    items: [
                        { id: "item3", name: "Item 3", quantity: 3 },
                        { id: "item4", name: "Item 4", quantity: 4 },
                    ],
                },
            ],
        });
        doc.commit();

        // Wait for sync to complete
        await waitForSync();
        mirror.sync();
        await waitForSync();

        // Verify that the new nested item was added
        expect(mirror.getState().categories[0].items).toHaveLength(3);
        expect(mirror.getState().categories[0].items[2].id).toBe("item5");
        expect(mirror.getState().categories[0].items[2].quantity).toBe(5);
    });

    /**
     * Compare synchronization behavior between schemas with and without idSelector
     */
    it("synchronizes lists correctly with and without idSelector", async () => {
        // Create two identical schemas, one with idSelector and one without
        const withIdSchema = schema({
            items: schema.LoroList(
                schema.LoroMap({
                    id: schema.String({ required: true }),
                    value: schema.String({ required: true }),
                }),
                (item) => item.id,
            ),
        });

        const withoutIdSchema = schema({
            items: schema.LoroList(
                schema.LoroMap({
                    id: schema.String({ required: true }),
                    value: schema.String({ required: true }),
                }),
                // No idSelector
            ),
        });

        const movableListSchema = schema({
            items: schema.LoroMovableList(
                schema.LoroMap({
                    id: schema.String({ required: true }),
                    value: schema.String({ required: true }),
                }),
                (item) => item.id,
            ),
        });

        // Create mirrors for both schemas
        const docWithId = new LoroDoc();
        // Set up container for docWithId
        docWithId.getList("items");
        docWithId.commit();

        const mirrorWithId = new Mirror({
            doc: docWithId,
            schema: withIdSchema,
        });

        const docWithoutId = new LoroDoc();
        // Set up container for docWithoutId
        docWithoutId.getList("items");
        docWithoutId.commit();

        const mirrorWithoutId = new Mirror({
            doc: docWithoutId,
            schema: withoutIdSchema,
        });

        const docMovable = new LoroDoc();
        // Set up container for docWithoutId
        docMovable.getMovableList("items");
        docMovable.commit();

        const mirrorMovable = new Mirror({
            doc: docMovable,
            schema: movableListSchema,
        });


        // Generate 10 items
        const items = Array.from({ length: 10 }, (_, i) => ({
            id: `id-${i}`,
            value: `value-${i}`,
        }));

        // Set initial state for both
        mirrorWithId.setState({ items });
        mirrorWithoutId.setState({ items });
        mirrorMovable.setState({ items });
        docWithId.commit();
        docWithoutId.commit();
        docMovable.commit();

        // Wait for sync to complete
        await waitForSync();
        mirrorWithId.sync();
        mirrorWithoutId.sync();
        mirrorMovable.sync();
        await waitForSync();

        // Verify initial state
        expect(mirrorWithId.getState().items).toHaveLength(10);
        expect(mirrorWithoutId.getState().items).toHaveLength(10);
        expect(mirrorMovable.getState().items).toHaveLength(10);

        // Reorder the items (reverse them)
        const reversedItems = [...items].reverse();

        // Update both mirrors
        mirrorWithId.setState({ items: reversedItems });
        mirrorWithoutId.setState({ items: reversedItems });
        mirrorMovable.setState({ items: reversedItems });
        docWithId.commit();
        docWithoutId.commit();

        // Wait for sync to complete
        await waitForSync();
        mirrorWithId.sync();
        mirrorWithoutId.sync();
        await waitForSync();

        // Verify that both mirrors correctly reordered the items
        for (let i = 0; i < 10; i++) {
            expect(mirrorWithId.getState().items[i].id).toBe(`id-${9 - i}`);
            expect(mirrorWithoutId.getState().items[i].id).toBe(`id-${9 - i}`);
            expect(mirrorMovable.getState().items[i].id).toBe(`id-${9 - i}`);
        }

        // Only compare the items arrays, not the full state objects with temp maps
        expect(mirrorWithId.getState().items).toEqual(
            mirrorWithoutId.getState().items,
        );

        expect(mirrorWithoutId.getState().items).toEqual(
            mirrorMovable.getState().items,
        );

    });

});
