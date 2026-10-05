/**
 * The design panel's design system parts, composed: the instance,
 * component, and property binding sections for the selected layer, the
 * style controls of its fill, stroke, text, and effect sections, and the
 * local styles shown when nothing is selected.
 */

import type { PropertyKind } from '@core/fig-engine/design-types';
import { type JSX, Show } from 'solid-js';
import { BindingsSection } from '../components/bindings-section';
import { ComponentSection } from '../components/component-section';
import { InstanceSection } from '../components/instance-section';
import { LocalStyles } from '../components/local-styles';
import { StyleControl } from '../components/style-control';
import {
  VariableControl,
  VariableModes,
  VariablesList,
} from '../components/variable-controls';
import {
  defaultPropertyName,
  type PropertyInput,
  type StyleKind,
} from '../core/design-system';
import type { DesignSystem } from '../primitives/create-design-system';

const KIND_FOR_FIELD = {
  VISIBLE: 'BOOL',
  TEXT: 'TEXT',
  INSTANCE_SWAP: 'INSTANCE_SWAP',
} as const;

/** The selected layer's instance, component, and binding sections. */
export function DesignSystemSections(props: {
  ds: DesignSystem;
  /** The selected layer's id. */
  selected: string | undefined;
}) {
  const ds = props.ds;
  const edit = () => ds.editable();
  /** A default for a new instance swap property: another component. */
  const someComponent = (except: string): PropertyInput | undefined => {
    const c = ds.components().find((x) => x.id !== except);
    return c ? { component: c.id } : undefined;
  };
  return (
    <>
      <Show when={ds.info()?.instance}>
        {(instance) => (
          <InstanceSection
            instance={instance()}
            components={ds.components()}
            actions={{
              onGoToMain: () => {
                const main = instance().main;
                if (main) void ds.reveal(main.id, instance().mainPage);
              },
              onSetProperty: edit()
                ? (id, property, value) =>
                    void ds.setProperty(id, property, value)
                : undefined,
              onReset: edit()
                ? (id, property) => void ds.resetInstance(id, property)
                : undefined,
              onSwap: edit()
                ? (id, component) => void ds.swapInstance(id, component)
                : undefined,
            }}
          />
        )}
      </Show>
      <Show when={ds.info()?.component}>
        {(panel) => {
          const owner = () => panel().owner.id;
          return (
            <ComponentSection
              panel={panel()}
              components={ds.components()}
              actions={
                edit()
                  ? {
                      onCreateProperty: (kind, name) =>
                        void ds.addComponentProperty(
                          props.selected ?? owner(),
                          name,
                          kind,
                          kind === 'INSTANCE_SWAP'
                            ? someComponent(owner())
                            : kind === 'VARIANT'
                              ? { text: 'Default' }
                              : undefined
                        ),
                      onRenameProperty: (property, name) =>
                        void ds.editComponentProperty(owner(), property, {
                          name,
                        }),
                      onSetDefault: (property, value) =>
                        void ds.editComponentProperty(owner(), property, {
                          value,
                        }),
                      onDeleteProperty: (property) =>
                        void ds.deleteComponentProperty(owner(), property),
                      onRenameVariantProperty: (from, to) =>
                        void ds.renameVariantProperty(owner(), from, to),
                      onRemoveVariantProperty: (name) =>
                        void ds.removeVariantProperty(owner(), name),
                      onSetVariantValue: (property, value) => {
                        const id = props.selected;
                        if (id) void ds.setVariantValue(id, property, value);
                      },
                      onAddVariant: () => {
                        const p = panel();
                        if (p.isSet) void ds.addVariant(owner());
                        else if (p.isVariant)
                          void ds.addVariant(owner(), props.selected);
                        else if (props.selected)
                          void ds.makeVariants(props.selected);
                      },
                    }
                  : undefined
              }
            />
          );
        }}
      </Show>
      <VariableModes
        modes={ds.info()?.modes ?? []}
        onMode={
          ds.editable()
            ? (collection, mode) => void ds.setVariableMode(collection, mode)
            : undefined
        }
      />
      <Show when={ds.info()?.layer}>
        {(bindings) => (
          <BindingsSection
            bindings={bindings()}
            actions={
              edit() && props.selected
                ? {
                    onBind: (field, property) => {
                      if (props.selected)
                        void ds.bindProperty(props.selected, field, property);
                    },
                    onCreate: (field) => {
                      const kind: PropertyKind = KIND_FOR_FIELD[field];
                      const taken = bindings().properties.map((p) => p.name);
                      if (props.selected)
                        void ds.addComponentProperty(
                          bindings().owner.id,
                          defaultPropertyName(kind, taken),
                          kind,
                          undefined,
                          props.selected
                        );
                    },
                    onExpose: (exposed) => {
                      if (props.selected)
                        void ds.exposeInstance(props.selected, exposed);
                    },
                  }
                : undefined
            }
          />
        )}
      </Show>
    </>
  );
}

/** The style control of one of the design panel's paint or type sections. */
export function styleControlFor(ds: DesignSystem) {
  const KEYS = {
    FILL: 'fill',
    STROKE: 'stroke',
    TEXT: 'text',
    EFFECT: 'effect',
  } as const;
  return (kind: StyleKind): JSX.Element => (
    <>
      <Show when={kind === 'FILL' || kind === 'STROKE'}>
        <VariableControl
          kind={kind === 'STROKE' ? 'STROKE' : 'FILL'}
          bound={
            (kind === 'STROKE'
              ? ds.info()?.variables.strokes[0]
              : ds.info()?.variables.fills[0]) ?? null
          }
          collections={ds.variables()}
          onBind={
            ds.editable()
              ? (variable) =>
                  void ds.bindVariable(
                    kind === 'STROKE' ? 'STROKE' : 'FILL',
                    variable
                  )
              : undefined
          }
        />
      </Show>
      <StyleControl
        kind={kind}
        applied={ds.info()?.styles[KEYS[kind]] ?? null}
        styles={ds.styles()}
        onApply={
          ds.editable() ? (style) => void ds.applyStyle(kind, style) : undefined
        }
        onCreate={
          ds.editable() ? (name) => void ds.createStyle(kind, name) : undefined
        }
      />
    </>
  );
}

/** Local styles, for the design panel with nothing selected. */
export function LocalStylesView(props: {
  ds: DesignSystem;
  swatches?: readonly string[];
}) {
  const ds = props.ds;
  // A drag of a color or a size is one undo step.
  let gesture: string | undefined;
  let gestures = 0;
  const key = (what: string, live: boolean) => {
    if (!live) {
      const k = gesture;
      gesture = undefined;
      return k;
    }
    gesture ??= `style-${what}-${++gestures}`;
    return gesture;
  };
  return (
    <>
      <LocalStyles
        styles={ds.styles()}
        swatches={props.swatches}
        actions={
          ds.editable()
            ? {
                onRename: (style, name) => void ds.editStyle(style, { name }),
                onColor: (style, hex, live) =>
                  void ds.editStyle(
                    style,
                    { props: { fills: [{ color: hex }] } },
                    key(`${style}-color`, live)
                  ),
                onFontSize: (style, fontSize, live) =>
                  void ds.editStyle(
                    style,
                    { props: { fontSize } },
                    key(`${style}-size`, live)
                  ),
                onDelete: (style) => void ds.deleteStyle(style),
              }
            : undefined
        }
      />
      <VariablesList collections={ds.variables()} />
    </>
  );
}
