-- Test fixture for task parent/subtask bidirectional linking tests
--
-- Parent Task UUID: 00000001-0000-0000-0000-000000000005
-- Subtasks UUID:    00000001-0000-0000-0000-000000000006
--
-- Task IDs (as UUIDs converted to strings):
--   task-parent-a = 20000001-0000-0000-0000-000000000001
--   task-parent-b = 20000001-0000-0000-0000-000000000002
--   task-child-1  = 20000001-0000-0000-0000-000000000003
--   task-child-2  = 20000001-0000-0000-0000-000000000004
--   task-child-3  = 20000001-0000-0000-0000-000000000005
--   task-orphan   = 20000001-0000-0000-0000-000000000006
--   task-standalone = 20000001-0000-0000-0000-000000000007
--
-- Task hierarchy for tests:
--   task-parent-a
--     └── task-child-1 (subtask of task-parent-a)
--     └── task-child-2 (subtask of task-parent-a)
--   task-parent-b
--     └── task-child-3 (subtask of task-parent-b)
--   task-orphan (no parent, no subtasks)
--   task-standalone (has properties attached but empty values)

-- Task: task-parent-a with Subtasks = [task-child-1, task-child-2]
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000001',
    '20000001-0000-0000-0000-000000000001', -- task-parent-a
    'TASK',
    '00000001-0000-0000-0000-000000000006', -- Subtasks
    '{"type": "EntityReference", "value": [{"entity_id": "20000001-0000-0000-0000-000000000003", "entity_type": "TASK"}, {"entity_id": "20000001-0000-0000-0000-000000000004", "entity_type": "TASK"}]}'::jsonb,
    NOW(),
    NOW()
);

-- Task: task-parent-a with Parent Task = NULL (attached but empty)
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000002',
    '20000001-0000-0000-0000-000000000001', -- task-parent-a
    'TASK',
    '00000001-0000-0000-0000-000000000005', -- Parent Task
    NULL,
    NOW(),
    NOW()
);

-- Task: task-child-1 with Parent Task = task-parent-a
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000003',
    '20000001-0000-0000-0000-000000000003', -- task-child-1
    'TASK',
    '00000001-0000-0000-0000-000000000005', -- Parent Task
    '{"type": "EntityReference", "value": [{"entity_id": "20000001-0000-0000-0000-000000000001", "entity_type": "TASK"}]}'::jsonb,
    NOW(),
    NOW()
);

-- Task: task-child-1 with Subtasks = [] (attached but empty)
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000004',
    '20000001-0000-0000-0000-000000000003', -- task-child-1
    'TASK',
    '00000001-0000-0000-0000-000000000006', -- Subtasks
    NULL,
    NOW(),
    NOW()
);

-- Task: task-child-2 with Parent Task = task-parent-a
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000005',
    '20000001-0000-0000-0000-000000000004', -- task-child-2
    'TASK',
    '00000001-0000-0000-0000-000000000005', -- Parent Task
    '{"type": "EntityReference", "value": [{"entity_id": "20000001-0000-0000-0000-000000000001", "entity_type": "TASK"}]}'::jsonb,
    NOW(),
    NOW()
);

-- Task: task-child-2 with Subtasks = [] (attached but empty)
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000006',
    '20000001-0000-0000-0000-000000000004', -- task-child-2
    'TASK',
    '00000001-0000-0000-0000-000000000006', -- Subtasks
    NULL,
    NOW(),
    NOW()
);

-- Task: task-parent-b with Subtasks = [task-child-3]
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000007',
    '20000001-0000-0000-0000-000000000002', -- task-parent-b
    'TASK',
    '00000001-0000-0000-0000-000000000006', -- Subtasks
    '{"type": "EntityReference", "value": [{"entity_id": "20000001-0000-0000-0000-000000000005", "entity_type": "TASK"}]}'::jsonb,
    NOW(),
    NOW()
);

-- Task: task-parent-b with Parent Task = NULL
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000008',
    '20000001-0000-0000-0000-000000000002', -- task-parent-b
    'TASK',
    '00000001-0000-0000-0000-000000000005', -- Parent Task
    NULL,
    NOW(),
    NOW()
);

-- Task: task-child-3 with Parent Task = task-parent-b
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000009',
    '20000001-0000-0000-0000-000000000005', -- task-child-3
    'TASK',
    '00000001-0000-0000-0000-000000000005', -- Parent Task
    '{"type": "EntityReference", "value": [{"entity_id": "20000001-0000-0000-0000-000000000002", "entity_type": "TASK"}]}'::jsonb,
    NOW(),
    NOW()
);

-- Task: task-child-3 with Subtasks = []
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000010',
    '20000001-0000-0000-0000-000000000005', -- task-child-3
    'TASK',
    '00000001-0000-0000-0000-000000000006', -- Subtasks
    NULL,
    NOW(),
    NOW()
);

-- Task: task-orphan with Parent Task = NULL (no parent)
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000011',
    '20000001-0000-0000-0000-000000000006', -- task-orphan
    'TASK',
    '00000001-0000-0000-0000-000000000005', -- Parent Task
    NULL,
    NOW(),
    NOW()
);

-- Task: task-orphan with Subtasks = []
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000012',
    '20000001-0000-0000-0000-000000000006', -- task-orphan
    'TASK',
    '00000001-0000-0000-0000-000000000006', -- Subtasks
    NULL,
    NOW(),
    NOW()
);

-- Task: task-standalone with Parent Task attached (empty)
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000013',
    '20000001-0000-0000-0000-000000000007', -- task-standalone
    'TASK',
    '00000001-0000-0000-0000-000000000005', -- Parent Task
    NULL,
    NOW(),
    NOW()
);

-- Task: task-standalone with Subtasks attached (empty)
INSERT INTO entity_properties (id, entity_id, entity_type, property_definition_id, values, created_at, updated_at)
VALUES (
    '10000001-0000-0000-0000-000000000014',
    '20000001-0000-0000-0000-000000000007', -- task-standalone
    'TASK',
    '00000001-0000-0000-0000-000000000006', -- Subtasks
    NULL,
    NOW(),
    NOW()
);
