import { describe, it, expect, beforeEach } from 'vitest';
import {
  initWorkingDb,
  generateTaskId,
  createTask,
  getTask,
  getTaskState,
  updateTaskMeta,
  deleteTask,
  listActiveTasks,
  addStep,
  updateStep,
  addFinding,
  addArtifact,
  addQuestion,
  resolveQuestion,
  getPromotableFindings,
} from '../../src/working/db.js';

// Re-init a fresh DB before each test
beforeEach(() => {
  initWorkingDb();
});

describe('generateTaskId', () => {
  it('produces unique ids', () => {
    const a = generateTaskId();
    const b = generateTaskId();
    expect(a).toMatch(/^task_\d+_[a-z0-9]+$/);
    expect(a).not.toBe(b);
  });
});

describe('tasks', () => {
  it('creates and retrieves a task', () => {
    const id = generateTaskId();
    createTask(id, 'Deploy new service', ['no downtime'], ['step 1', 'step 2']);
    const task = getTask(id);
    expect(task).toBeDefined();
    expect(task!.goal).toBe('Deploy new service');
    expect(task!.status).toBe('active');
    expect(JSON.parse(task!.constraints!)).toEqual(['no downtime']);
  });

  it('returns undefined for unknown task', () => {
    expect(getTask('nonexistent')).toBeUndefined();
  });

  it('lists only active tasks', () => {
    const id1 = generateTaskId();
    const id2 = generateTaskId();
    createTask(id1, 'Task A');
    createTask(id2, 'Task B');
    updateTaskMeta(id2, { status: 'completed' });

    const active = listActiveTasks();
    expect(active.length).toBe(1);
    expect(active[0]!.task_id).toBe(id1);
  });

  it('updates current_step and plan', () => {
    const id = generateTaskId();
    createTask(id, 'Some goal');
    updateTaskMeta(id, { current_step: 'Running tests', plan: ['a', 'b'] });
    const task = getTask(id);
    expect(task!.current_step).toBe('Running tests');
    expect(JSON.parse(task!.plan!)).toEqual(['a', 'b']);
  });

  it('deletes task and all related rows', () => {
    const id = generateTaskId();
    createTask(id, 'Temp task');
    addStep(id, 'step one');
    addFinding(id, 'found something', 'high', 'semantic');
    addArtifact(id, 'output.json', '/tmp/output.json');
    addQuestion(id, 'Why did it fail?');

    deleteTask(id);
    expect(getTask(id)).toBeUndefined();
    expect(getTaskState(id)).toBeUndefined();
  });
});

describe('steps', () => {
  it('adds and completes a step', () => {
    const id = generateTaskId();
    createTask(id, 'Goal');
    const stepId = addStep(id, 'Install dependencies');

    updateStep(stepId, 'completed');

    const state = getTaskState(id)!;
    expect(state.steps.length).toBe(1);
    expect(state.steps[0]!.status).toBe('completed');
    expect(state.steps[0]!.completed_at).not.toBeNull();
  });

  it('marks a step as failed', () => {
    const id = generateTaskId();
    createTask(id, 'Goal');
    const stepId = addStep(id, 'Risky operation');
    updateStep(stepId, 'failed');

    const state = getTaskState(id)!;
    expect(state.steps[0]!.status).toBe('failed');
  });
});

describe('findings', () => {
  it('adds finding with all fields', () => {
    const id = generateTaskId();
    createTask(id, 'Goal');
    addFinding(id, 'SQLite is fast', 'high', 'semantic');

    const state = getTaskState(id)!;
    expect(state.findings.length).toBe(1);
    expect(state.findings[0]!.content).toBe('SQLite is fast');
    expect(state.findings[0]!.importance).toBe('high');
    expect(state.findings[0]!.memory_type).toBe('semantic');
  });

  it('defaults importance to medium', () => {
    const id = generateTaskId();
    createTask(id, 'Goal');
    addFinding(id, 'Some observation');

    const state = getTaskState(id)!;
    expect(state.findings[0]!.importance).toBe('medium');
  });

  it('getPromotableFindings excludes low importance', () => {
    const id = generateTaskId();
    createTask(id, 'Goal');
    addFinding(id, 'Low priority', 'low', 'episodic');
    addFinding(id, 'Medium insight', 'medium', 'semantic');
    addFinding(id, 'High value', 'high', 'procedural');

    const promotable = getPromotableFindings(id);
    expect(promotable.length).toBe(2);
    expect(promotable.map((f) => f.importance)).not.toContain('low');
  });
});

describe('artifacts', () => {
  it('records and retrieves artifacts', () => {
    const id = generateTaskId();
    createTask(id, 'Goal');
    addArtifact(id, 'build output', 'dist/index.js');

    const state = getTaskState(id)!;
    expect(state.artifacts.length).toBe(1);
    expect(state.artifacts[0]!.name).toBe('build output');
    expect(state.artifacts[0]!.reference).toBe('dist/index.js');
  });
});

describe('questions', () => {
  it('adds and resolves a question', () => {
    const id = generateTaskId();
    createTask(id, 'Goal');
    const qId = addQuestion(id, 'Why is it slow?');

    resolveQuestion(qId, 'Missing index on the DB table');

    const state = getTaskState(id)!;
    expect(state.questions[0]!.resolved).toBe(1);
    expect(state.questions[0]!.resolution).toBe('Missing index on the DB table');
  });

  it('unresolved questions have resolved=0', () => {
    const id = generateTaskId();
    createTask(id, 'Goal');
    addQuestion(id, 'Open question');

    const state = getTaskState(id)!;
    expect(state.questions[0]!.resolved).toBe(0);
  });
});

describe('getTaskState', () => {
  it('returns full state with all relations', () => {
    const id = generateTaskId();
    createTask(id, 'Full state test');
    addStep(id, 'step A');
    addFinding(id, 'finding 1', 'high', 'episodic');
    addFinding(id, 'finding 2', 'medium', 'procedural');
    addArtifact(id, 'file', 'path/to/file');
    addQuestion(id, 'unanswered?');

    const state = getTaskState(id)!;
    expect(state.task.goal).toBe('Full state test');
    expect(state.steps.length).toBe(1);
    expect(state.findings.length).toBe(2);
    expect(state.artifacts.length).toBe(1);
    expect(state.questions.length).toBe(1);
  });
});
