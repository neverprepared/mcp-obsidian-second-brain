import { z } from 'zod';

export const ParaCategorySchema = z.enum(['projects', 'areas', 'resources', 'archives']);
export type ParaCategory = z.infer<typeof ParaCategorySchema>;

export const ConfidenceSchema = z.enum(['low', 'medium', 'high']);
export type Confidence = z.infer<typeof ConfidenceSchema>;

export const StatusSchema = z.enum(['active', 'stale', 'archived']);
export type Status = z.infer<typeof StatusSchema>;

export const SourceSchema = z.enum(['conversation', 'manual', 'import']);
export type Source = z.infer<typeof SourceSchema>;

export const FrontmatterSchema = z.object({
  id: z.string(),
  title: z.string().min(1).max(200),
  para: ParaCategorySchema,
  tags: z.array(z.string()).default([]),
  created: z.string(),
  updated: z.string(),
  source: SourceSchema.default('conversation'),
  related: z.array(z.string()).default([]),
  confidence: ConfidenceSchema.default('medium'),
  status: StatusSchema.default('active'),
  last_accessed: z.string().optional(),
  source_urls: z.array(z.string()).default([]),
  ttl_days: z.number().optional(),
  deadline: z.string().optional(),
});

export type Frontmatter = z.infer<typeof FrontmatterSchema>;
