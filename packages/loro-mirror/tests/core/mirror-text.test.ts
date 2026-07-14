import { Mirror } from "../../src/core/mirror";
import { LoroDoc, LoroText } from "loro-crdt";
import { schema } from "../../src/schema";
import { describe, expect, it } from "vitest";
import { valueIsContainer, valueIsContainerOfType } from "../../src/core/utils";

describe("Text Container Behave correctly", () => {
    // Utility function to wait for sync to complete (three microtasks for better reliability)
    const waitForSync = async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    };

    it("updates properly reflect when LoroText is at root", async () => {
        const doc = new LoroDoc();

        const schema_ = schema({
            text: schema.LoroText(),
        });

        const mirror = new Mirror({
            doc,
            schema: schema_,
        });

        mirror.setState({
            text: "Hello World",
        });

        mirror.sync();
        await waitForSync();

        let serialized = doc.getDeepValueWithID();

        // Text should be a LoroText Container
        expect(
            valueIsContainerOfType(serialized.text, ":Text"),
            "text field should be a LoroText Container",
        ).toBeTruthy();

        serialized = doc.getDeepValueWithID();

        expect(
            valueIsContainerOfType(serialized.text, ":Text"),
            "text field should be a LoroText Container -- set from mirror",
        ).toBeTruthy();

        expect(
            serialized.text.value,
            "text field should be 'Hello World' -- set from mirror",
        ).toBe("Hello World");

        doc.getText("text").update("Hello World 2");

        mirror.sync();
        await waitForSync();

        const mirrorState = mirror.getState();

        expect(
            mirrorState.text,
            "text field should be 'Hello World 2' -- set from loro",
        ).toBe("Hello World 2");

        serialized = doc.getDeepValueWithID();

        expect(
            valueIsContainerOfType(serialized.text, ":Text"),
            "text field should be a LoroText Container -- set from loro",
        ).toBeTruthy();
    });

    it("updates reflect when LoroText is within a LoroMap", async () => {
        const doc = new LoroDoc();
        const schema_ = schema({
            map: schema.LoroMap({
                text: schema.LoroText(),
            }),
        });
        const mirror = new Mirror({
            doc,
            schema: schema_,
        });

        mirror.setState({
            map: {
                text: "Hello World",
            },
        });

        mirror.sync();
        await waitForSync();

        let serialized = doc.getDeepValueWithID();

        expect(
            valueIsContainerOfType(serialized.map, ":Map"),
            "map field should be a LoroMap Container",
        );

        expect(
            valueIsContainerOfType(serialized.map.text, ":Text"),
            "text field should be a LoroText Container",
        );

        await waitForSync();

        serialized = doc.getDeepValueWithID();

        expect(
            valueIsContainerOfType(serialized.map, ":Map"),
            "map field should be a LoroMap Container -- set from mirror",
        ).toBeTruthy();

        expect(
            valueIsContainerOfType(serialized.map.value.text, ":Text"),
            "text field should be a LoroText Container -- set from mirror",
        ).toBeTruthy();

        expect(
            serialized.map.value.text.value,
            "text field should be 'Hello World' -- set from mirror",
        ).toBe("Hello World");

        const map = doc.getMap("map");
        const text = map.get("text") as LoroText;
        text.update("Hello World 2");

        mirror.sync();
        await waitForSync();

        const mirrorState = mirror.getState();

        expect(
            mirrorState.map.text,
            "text field should be 'Hello World 2' -- set from loro",
        ).toBe("Hello World 2");

        serialized = doc.getDeepValueWithID();

        expect(
            valueIsContainer(serialized.map) &&
                valueIsContainerOfType(serialized.map, ":Map"),
            "map field should be a LoroMap Container -- set from loro",
        );
    });

    it("updates reflect when LoroText is within LoroList", async () => {
        const doc = new LoroDoc();
        const schema_ = schema({
            list: schema.LoroList(schema.LoroText()),
        });
        const mirror = new Mirror({
            doc,
            schema: schema_,
        });

        mirror.setState({
            list: ["Hello World"],
        });

        mirror.sync();
        await waitForSync();

        let serialized = doc.getDeepValueWithID();

        expect(
            valueIsContainerOfType(serialized.list, ":List"),
            "list field should be a LoroList Container",
        ).toBeTruthy();

        expect(
            valueIsContainerOfType(serialized.list.value[0], ":Text"),
            "text field should be a LoroText Container",
        ).toBeTruthy();

        expect(
            serialized.list.value[0].value,
            "text field should be 'Hello World' -- set from mirror",
        ).toBe("Hello World");
    });
});
