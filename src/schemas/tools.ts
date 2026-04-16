import { z } from 'zod';
import { ParaCategorySchema, ConfidenceSchema, SourceSchema, StatusSchema } from './frontmatter.js';

export const FreshnessFilterSchema = z.enum(['all', 'fresh', 'stale']);
export type FreshnessFilter = z.infer<typeof FreshnessFilterSchema>;

export const TagModeSchema = z.enum(['and', 'or']).default('and');
export type TagMode = z.infer<typeof TagModeSchema>;

export const StoreInputSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(1),
  para: ParaCategorySchema,
  tags: z.array(z.string()).default([]),
  related: z.array(z.string()).default([]),
  confidence: ConfidenceSchema.default('medium'),
  source: SourceSchema.default('conversation'),
  source_urls: z.array(z.string()).default([]),
  ttl_days: z.number().optional(),
  deadline: z.string().optional(),
});
export type StoreInput = z.infer<typeof StoreInputSchema>;

export const RecallInputSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
}).refine(
  (data) => data.id || data.title,
  { message: 'Either id or title must be provided' }
);
export type RecallInput = z.infer<typeof RecallInputSchema>;

export const SearchInputSchema = z.object({
  query: z.string().optional(),
  tags: z.array(z.string()).optional(),
  tag_mode: TagModeSchema,
  para: ParaCategorySchema.optional(),
  status: StatusSchema.optional(),
  freshness: FreshnessFilterSchema.default('all'),
  limit: z.number().min(1).max(50).default(10),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
  updated_after: z.string().optional(),
  updated_before: z.string().optional(),
});
export type SearchInput = z.infer<typeof SearchInputSchema>;

export const ListInputSchema = z.object({
  para: ParaCategorySchema.optional(),
  tags: z.array(z.string()).optional(),
  tag_mode: TagModeSchema,
  status: StatusSchema.optional(),
  sort_by: z.enum(['created', 'updated', 'title']).default('updated'),
  limit: z.number().min(1).max(100).default(20),
  include_archived: z.boolean().default(false),
  created_after: z.string().optional(),
  created_before: z.string().optional(),
  updated_after: z.string().optional(),
  updated_before: z.string().optional(),
});
export type ListInput = z.infer<typeof ListInputSchema>;

export const UpdateInputSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200).optional(),
  content: z.string().optional(),
  append: z.boolean().default(false),
  para: ParaCategorySchema.optional(),
  tags: z.array(z.string()).optional(),
  add_tags: z.array(z.string()).optional(),
  related: z.array(z.string()).optional(),
  confidence: ConfidenceSchema.optional(),
  status: StatusSchema.optional(),
  source_urls: z.array(z.string()).optional(),
  ttl_days: z.number().optional(),
});
export type UpdateInput = z.infer<typeof UpdateInputSchema>;

export const ArchiveInputSchema = z.object({
  id: z.string(),
});
export type ArchiveInput = z.infer<typeof ArchiveInputSchema>;

export const DeleteInputSchema = z.object({
  id: z.string(),
  confirm: z.boolean(),
}).refine(
  (data) => data.confirm === true,
  { message: 'confirm must be true to delete a memory' }
);
export type DeleteInput = z.infer<typeof DeleteInputSchema>;

export const LinkInputSchema = z.object({
  source_id: z.string(),
  target_id: z.string().optional(),
  discover: z.boolean().default(false),
}).refine(
  (data) => data.discover || data.target_id,
  { message: 'Either target_id or discover: true must be provided' }
);
export type LinkInput = z.infer<typeof LinkInputSchema>;

export const CleanupInputSchema = z.object({
  action: z.enum(['list', 'archive', 'delete']).default('list'),
  target: z.enum(['stale', 'archived', 'orphan']).default('stale'),
  dry_run: z.boolean().default(true),
  limit: z.number().min(1).max(50).default(20),
  confirm: z.boolean().default(false),
}).refine(
  (data) => data.action !== 'delete' || data.confirm === true,
  { message: 'confirm must be true when action is delete' }
);
export type CleanupInput = z.infer<typeof CleanupInputSchema>;
