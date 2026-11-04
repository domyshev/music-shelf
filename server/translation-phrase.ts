import { z } from 'zod';

export const translationPhrase = z.string().trim().min(1).max(200)
  .refine(value => /[\p{L}\p{N}]/u.test(value) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value), 'Invalid text');
export const normalizePhrase = (value:string) => value.normalize('NFC').trim().replace(/\s+/gu,' ').toLowerCase();
