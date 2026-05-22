import type { LifecycleStatus } from '../schemas/frontmatter.js';

export const LIFECYCLE_DESCRIPTIONS: Record<LifecycleStatus, string> = {
  active: 'Time-bound or evolving content',
  reference: 'Stable reference material',
  archive: 'Completed or inactive items',
};
