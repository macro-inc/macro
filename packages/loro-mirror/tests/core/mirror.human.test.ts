import { LoroDoc, LoroMap, isContainer } from 'loro-crdt';
import { expect, it } from 'vitest';
import { Mirror } from '../../src/core/mirror';
import { schema } from '../../src/schema';

it('syncs initial state from LoroDoc correctly', async () => {
  const doc = new LoroDoc();
  const todoList = doc.getList('todos');
  const map = todoList.pushContainer(new LoroMap());
  map.set('id', '1');
  map.set('text', 'Buy milk');
  map.set('completed', false);
  const map2 = todoList.pushContainer(new LoroMap());
  map2.set('id', '2');
  map2.set('text', 'Write tests');
  map2.set('completed', true);
  doc.commit(); // Commit changes to the doc

  // Define schema
  const todoSchema = schema({
    todos: schema.LoroList(
      schema.LoroMap({
        id: schema.String(),
        text: schema.String(),
        completed: schema.Boolean(),
      }),
      (x) => x['id']
    ),
  });

  // Create mirror
  const mirror = new Mirror({
    doc,
    schema: todoSchema,
  });

  expect(mirror.getState().todos).toEqual([
    { id: '1', text: 'Buy milk', completed: false },
    { id: '2', text: 'Write tests', completed: true },
  ]);
  expect(doc.toJSON().todos).toEqual([
    { id: '1', text: 'Buy milk', completed: false },
    { id: '2', text: 'Write tests', completed: true },
  ]);

  let f = doc.frontiers();
  mirror.setState((state) => {
    return {
      todos: state.todos.map((todo) => ({
        ...todo,
        completed: !todo.completed,
      })),
    };
  });

  await Promise.resolve();
  expect(doc.toJSON()).toEqual({
    todos: [
      { id: '1', text: 'Buy milk', completed: true },
      { id: '2', text: 'Write tests', completed: false },
    ],
  });
  let f2 = doc.frontiers();
  expect(f2[0].counter - f[0].counter).toBe(2);
});

it('works without schema', async () => {
  const doc = new LoroDoc();
  const todoList = doc.getList('todos');
  const map = todoList.pushContainer(new LoroMap());
  map.set('id', '1');
  map.set('text', 'Buy milk');
  map.set('completed', false);
  const map2 = todoList.pushContainer(new LoroMap());
  map2.set('id', '2');
  map2.set('text', 'Write tests');
  map2.set('completed', true);
  doc.commit(); // Commit changes to the doc

  // Create mirror
  const mirror = new Mirror({ doc });
  expect(mirror.getState().todos).toEqual([
    { id: '1', text: 'Buy milk', completed: false },
    { id: '2', text: 'Write tests', completed: true },
  ]);
  expect(doc.toJSON().todos).toEqual([
    { id: '1', text: 'Buy milk', completed: false },
    { id: '2', text: 'Write tests', completed: true },
  ]);

  let f = doc.frontiers();
  mirror.setState((state) => {
    return {
      todos: state.todos.map((todo: any) => ({
        ...todo,
        completed: !todo.completed,
      })),
    };
  });

  await Promise.resolve();
  expect(doc.toJSON()).toEqual({
    todos: [
      { id: '1', text: 'Buy milk', completed: true },
      { id: '2', text: 'Write tests', completed: false },
    ],
  });
  let f2 = doc.frontiers();
  expect(f2[0].counter - f[0].counter).toBe(2);
});

it('syncing from state => LoroDoc', async () => {
  const doc = new LoroDoc();
  doc.setPeerId(1);
  const mirror = new Mirror({ doc });
  mirror.setState({
    todos: [
      { id: '1', text: 'Buy milk', completed: false },
      { id: '2', text: 'Write tests', completed: true },
    ],
  });
  expect(mirror.getState().todos).toEqual([
    { id: '1', text: 'Buy milk', completed: false },
    { id: '2', text: 'Write tests', completed: true },
  ]);
  expect(doc.toJSON().todos).toEqual([
    { id: '1', text: 'Buy milk', completed: false },
    { id: '2', text: 'Write tests', completed: true },
  ]);
  const f = doc.frontiers();
  mirror.setState((state) => {
    return {
      todos: state.todos.map((todo: any) => ({
        ...todo,
        completed: !todo.completed,
      })),
    };
  });
  await Promise.resolve();
  expect(doc.toJSON()).toEqual({
    todos: [
      { id: '1', text: 'Buy milk', completed: true },
      { id: '2', text: 'Write tests', completed: false },
    ],
  });
  const f2 = doc.frontiers();
  expect(f2[0].counter - f[0].counter).toBe(2);
  const v = doc.toJsonWithReplacer((_, v) => {
    if (isContainer(v)) {
      return {
        id: v.id,
        value: v.getShallowValue(),
      };
    } else {
      return v;
    }
  });
  expect(v).toMatchSnapshot();
});
