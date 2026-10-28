/**
 * The design panel's design system parts, composed: the instance,
 * component, and property binding sections for the selected layer, the
 * style controls of its fill, stroke, text, and effect sections, and the
 * local styles shown when nothing is selected.
 */

import type { PropertyKind } from '@core/fig-engine/design-types';
import { fireAndForget } from '@core/util/fireAndForget';
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
                if (main)
                  fireAndForget(
                    ds.reveal(main.id, instance().mainPage),
                    'fig-design-system'
                  );
              },
              onSetProperty: edit()
                ? (id, property, value) =>
                    fireAndForget(
                      ds.setProperty(id, property, value),
                      'fig-design-system'
                    )
                : undefined,
              onReset: edit()
                ? (id, property) =>
                    fireAndForget(
                      ds.resetInstance(id, property),
                      'fig-design-system'
                    )
                : undefined,
              onSwap: edit()
                ? (id, component) =>
                    fireAndForget(
                      ds.swapInstance(id, component),
                      'fig-design-system'
                    )
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
                        fireAndForget(
                          ds.addComponentProperty(
                            props.selected ?? owner(),
                            name,
                            kind,
                            kind === 'INSTANCE_SWAP'
                              ? someComponent(owner())
                              : kind === 'VARIANT'
                                ? { text: 'Default' }
                                : undefined
                          ),
                          'fig-design-system'
                        ),
                      onRenameProperty: (property, name) =>
                        fireAndForget(
                          ds.editComponentProperty(owner(), property, {
                            name,
                          }),
                          'fig-design-system'
                        ),
                      onSetDefault: (property, value) =>
                        fireAndForget(
                          ds.editComponentProperty(owner(), property, {
                            value,
                          }),
                          'fig-design-system'
                        ),
                      onDeleteProperty: (property) =>
                        fireAndForget(
                          ds.deleteComponentProperty(owner(), property),
                          'fig-design-system'
                        ),
                      onRenameVariantProperty: (from, to) =>
                        fireAndForget(
                          ds.renameVariantProperty(owner(), from, to),
                          'fig-design-system'
                        ),
                      onRemoveVariantProperty: (name) =>
                        fireAndForget(
                          ds.removeVariantProperty(owner(), name),
                          'fig-design-system'
                        ),
                      onSetVariantValue: (property, value) => {
                        const id = props.selected;
                        if (id)
                          fireAndForget(
                            ds.setVariantValue(id, property, value),
                            'fig-design-system'
                          );
                      },
                      onAddVariant: () => {
                        const p = panel();
                        if (p.isSet)
                          fireAndForget(
                            ds.addVariant(owner()),
                            'fig-design-system'
                          );
                        else if (p.isVariant)
                          fireAndForget(
                            ds.addVariant(owner(), props.selected),
                            'fig-design-system'
                          );
                        else if (props.selected)
                          fireAndForget(
                            ds.makeVariants(props.selected),
                            'fig-design-system'
                          );
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
            ? (collection, mode) =>
                fireAndForget(
                  ds.setVariableMode(collection, mode),
                  'fig-design-system'
                )
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
                        fireAndForget(
                          ds.bindProperty(props.selected, field, property),
                          'fig-design-system'
                        );
                    },
                    onCreate: (field) => {
                      const kind: PropertyKind = KIND_FOR_FIELD[field];
                      const taken = bindings().properties.map((p) => p.name);
                      if (props.selected)
                        fireAndForget(
                          ds.addComponentProperty(
                            bindings().owner.id,
                            defaultPropertyName(kind, taken),
                            kind,
                            undefined,
                            props.selected
                          ),
                          'fig-design-system'
                        );
                    },
                    onExpose: (exposed) => {
                      if (props.selected)
                        fireAndForget(
                          ds.exposeInstance(props.selected, exposed),
                          'fig-design-system'
                        );
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
                  fireAndForget(
                    ds.bindVariable(
                      kind === 'STROKE' ? 'STROKE' : 'FILL',
                      variable
                    ),
                    'fig-design-system'
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
          ds.editable()
            ? (style) =>
                fireAndForget(ds.applyStyle(kind, style), 'fig-design-system')
            : undefined
        }
        onCreate={
          ds.editable()
            ? (name) =>
                fireAndForget(ds.createStyle(kind, name), 'fig-design-system')
            : undefined
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
                onRename: (style, name) =>
                  fireAndForget(
                    ds.editStyle(style, { name }),
                    'fig-design-system'
                  ),
                onColor: (style, hex, live) =>
                  fireAndForget(
                    ds.editStyle(
                      style,
                      { props: { fills: [{ color: hex }] } },
                      key(`${style}-color`, live)
                    ),
                    'fig-design-system'
                  ),
                onFontSize: (style, fontSize, live) =>
                  fireAndForget(
                    ds.editStyle(
                      style,
                      { props: { fontSize } },
                      key(`${style}-size`, live)
                    ),
                    'fig-design-system'
                  ),
                onDelete: (style) =>
                  fireAndForget(ds.deleteStyle(style), 'fig-design-system'),
              }
            : undefined
        }
      />
      <VariablesList collections={ds.variables()} />
    </>
  );
}
