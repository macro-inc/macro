import { Mirror } from "../../src/core/mirror";
import { LoroDoc } from "loro-crdt";
import { schema } from "../../src/schema";
import { describe, expect, it } from "vitest";
import { valueIsContainerOfType } from "../../src/core/utils";

describe("MovableList", () => {
    // Utility function to wait for sync to complete (three microtasks for better reliability)
    const waitForSync = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    };

    async function initTestMirror() {
        const doc = new LoroDoc();
        doc.setPeerId(1);
        const schema_ = schema({
            list: schema.LoroMovableList(
                schema.LoroMap({
                    id: schema.String(),
                    text: schema.LoroText(),
                }),
                (item) => item.id,
            ),
        });

        const mirror = new Mirror({
            doc,
            schema: schema_,
        });

        mirror.setState({
            list: [
                {
                    id: "1",
                    text: "Hello World",
                },
            ],
        });

        mirror.sync();
        await waitForSync();

        return { mirror, doc };
    }

    it("movable list properly initializes containers", async () => {
        const { doc } = await initTestMirror();
        let serialized = doc.getDeepValueWithID();

        expect(
            valueIsContainerOfType(serialized.list, ":MovableList"),
            "list field should be a LoroMovableList Container",
        ).toBeTruthy();

        expect(
            valueIsContainerOfType(serialized.list.value[0], ":Map"),
            "list item should be a LoroMap Container",
        ).toBeTruthy();

        expect(
            valueIsContainerOfType(
                serialized.list.value[0].value.text,
                ":Text",
            ),
            "list item text should be a LoroText Container",
        ).toBeTruthy();
    });

    it("movable list items retain container ids on insert + move", async () => {
        const { mirror, doc } = await initTestMirror();

        const initialSerialized = doc.getDeepValueWithID();

        // Id of the container for the first item in the original list
        const initialId = initialSerialized.list.value[0].cid;

        mirror.setState({
            list: [
                {
                    id: "2",
                    text: "Hello World",
                },
                {
                    id: "1",
                    text: "Hello World",
                },
            ],
        });

        mirror.sync();
        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        // The second item should have the same id as the first item
        // Since all we did was move the item, the id should be the same
        expect(serialized.list.value[1].cid).toBe(initialId);
    });

    it("movable list handles insertion of items correctly", async () => {
        const { mirror, doc } = await initTestMirror();

        mirror.setState({
            list: [
                {
                    id: "1",
                    text: "Hello World",
                },
                {
                    id: "2",
                    text: "Hello World",
                },
                {
                    id: "3",
                    text: "Hello World",
                },
            ],
        });

        mirror.sync();
        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        expect(
            serialized.list.value.length,
            "list should have three items",
        ).toBe(3);
    });

    it("movable list handles shuffling of many items at once correctly", async () => {
        const { mirror, doc } = await initTestMirror();

        mirror.setState({
            list: [
                {
                    id: "1",
                    text: "Hello World",
                },
                {
                    id: "2",
                    text: "Hello World",
                },
                {
                    id: "3",
                    text: "Hello World",
                },
            ],
        });

        mirror.sync();
        await waitForSync();

        const initialSerialized = doc.getDeepValueWithID();

        const initialIdOfFirstItem = initialSerialized.list.value[0].cid;
        const initialIdOfSecondItem = initialSerialized.list.value[1].cid;
        const initialIdOfThirdItem = initialSerialized.list.value[2].cid;

        const deriredState = {
            list: [
                {
                    id: "2",
                    text: "Hello World",
                },
                {
                    id: "3",
                    text: "Hello World",
                },
                {
                    id: "1",
                    text: "Hello World",
                },
            ],
        };

        mirror.setState(deriredState);

        mirror.sync();
        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        expect(
            serialized.list.value[0].cid,
            "first item should have the same id as the second item",
        ).toBe(initialIdOfSecondItem);

        expect(
            serialized.list.value[1].cid,
            "second item should have the same id as the third item",
        ).toBe(initialIdOfThirdItem);

        expect(
            serialized.list.value[2].cid,
            "third item should have the same id as the first item",
        ).toBe(initialIdOfFirstItem);

        expect(serialized.list.value[0].value.id).toBe("2");
        expect(serialized.list.value[1].value.id).toBe("3");
        expect(serialized.list.value[2].value.id).toBe("1");

        expect(mirror.getState()).toEqual(deriredState);
    });

    it("movable list shuffle with updates should shuffle and update", async () => {
        const { mirror, doc } = await initTestMirror();

        mirror.setState({
            list: [
                {
                    id: "1",
                    text: "Hello World",
                },
                {
                    id: "2",
                    text: "Hello World",
                },
                {
                    id: "3",
                    text: "Hello World",
                },
            ],
        });

        mirror.sync();
        await waitForSync();

        const desiredState = {
            list: [
                {
                    id: "2",
                    text: "Hello World Updated 2",
                },
                {
                    id: "3",
                    text: "Hello World Updated 3",
                },
                {
                    id: "1",
                    text: "Hello World Updated 1",
                },
            ],
        };

        mirror.setState(desiredState);

        mirror.sync();
        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        expect(
            serialized.list.value[0].value.id,
            "first item should have the right id",
        ).toBe("2");

        expect(
            serialized.list.value[1].value.id,
            "second item should have the right id",
        ).toBe("3");

        expect(
            serialized.list.value[2].value.id,
            "third item should have the right id",
        ).toBe("1");

        expect(
            serialized.list.value[0].value.text.value,
            "first item should have the right text",
        ).toBe("Hello World Updated 2");

        expect(
            serialized.list.value[1].value.text.value,
            "second item should have the right text",
        ).toBe("Hello World Updated 3");

        expect(
            serialized.list.value[2].value.text.value,
            "third item should have the right text",
        ).toBe("Hello World Updated 1");

        expect(mirror.getState()).toEqual(desiredState);
    });

    it("movable list handles basic insert", async () => {
        const { mirror, doc } = await initTestMirror();

        const desiredState = {
            list: [
                {
                    id: "1",
                    text: "Hello World",
                },
                {
                    id: "2",
                    text: "Hello World",
                },
            ],
        };

        mirror.setState(desiredState);

        mirror.sync();
        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        expect(serialized.list.value.length, "list should have two items").toBe(
            2,
        );

        expect(mirror.getState()).toEqual(desiredState);
    });

    it("movable list handles basic delete", async () => {
        const { mirror, doc } = await initTestMirror();

        mirror.setState({
            list: [],
        });

        mirror.sync();
        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        expect(serialized.list.value.length, "list should have one item").toBe(
            0,
        );
    });

    it("movable list handles basic update", async () => {
        const { mirror, doc } = await initTestMirror();

        const desiredState = {
            list: [
                {
                    id: "1",
                    text: "Hello World 4",
                },
            ],
        };

        mirror.setState(desiredState);

        mirror.sync();
        await waitForSync();

        const serialized = doc.getDeepValueWithID();

        expect(
            serialized.list.value[0].value.text.value,
            "text should be updated",
        ).toBe("Hello World 4");

        expect(mirror.getState()).toEqual(desiredState);
    });
});
