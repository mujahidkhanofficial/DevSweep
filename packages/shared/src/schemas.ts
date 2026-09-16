import { z } from 'zod';

export const CleanupCategorySchema = z.enum([
  'NODE',
  'GRADLE',
  'ANDROID',
  'FLUTTER',
  'IDE',
  'SYSTEM',
  'GENERAL'
]);

export const SafetyLevelSchema = z.enum(['SAFE', 'REBUILDABLE', 'REVIEW', 'PROTECTED']);

export const StartScanRequestSchema = z.object({
  categories: z.array(CleanupCategorySchema).optional(),
  targetDrive: z.string().regex(/^[A-Z]:$/i).optional()
});

export const CancelScanRequestSchema = z.object({
  scanSessionId: z.string().min(1)
});

export const ExecuteCleanupRequestSchema = z.object({
  scanSessionId: z.string().min(1),
  ruleId: z.string().optional(),
  selectedItemIds: z.array(z.string().min(1)),
  dryRun: z.boolean().default(false)
});

export const AddProtectedPathSchema = z.object({
  path: z.string().min(1)
});

export const RemoveProtectedPathSchema = z.object({
  path: z.string().min(1)
});

export type StartScanRequest = z.infer<typeof StartScanRequestSchema>;
export type CancelScanRequest = z.infer<typeof CancelScanRequestSchema>;
export type ExecuteCleanupRequest = z.infer<typeof ExecuteCleanupRequestSchema>;
export type AddProtectedPathRequest = z.infer<typeof AddProtectedPathSchema>;
export type RemoveProtectedPathRequest = z.infer<typeof RemoveProtectedPathSchema>;
