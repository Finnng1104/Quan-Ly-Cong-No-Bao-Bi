import { z } from 'zod'
import { AppError } from './errors.js'
import { isValidIsoDate } from './dates.js'

// Upper bounds protect against typos and against arithmetic leaving the safe-integer range.
export const MAX_MONEY = 100_000_000_000
export const MAX_PRICE = 1_000_000_000
export const MAX_QTY = 1_000_000

function fieldKey(path: readonly PropertyKey[]): string {
  return path.reduce<string>((key, segment) => {
    if (typeof segment === 'number') return `${key}[${segment}]`
    return key === '' ? String(segment) : `${key}.${String(segment)}`
  }, '')
}

/** Validates request input and turns failures into the standard 400 body with per-field messages. */
export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input)
  if (result.success) return result.data

  const fields: Record<string, string> = {}
  for (const issue of result.error.issues) {
    const key = fieldKey(issue.path) || '_'
    fields[key] ??= issue.message
  }
  throw new AppError('VALIDATION_ERROR', 'Dữ liệu không hợp lệ', fields)
}

export const isoDateSchema = z
  .string({ error: 'Bắt buộc' })
  .refine((value) => isValidIsoDate(value), { error: 'Ngày không hợp lệ' })

export const nonEmptyText = (maxLength = 200) =>
  z
    .string({ error: 'Bắt buộc' })
    .trim()
    .min(1, { error: 'Bắt buộc' })
    .max(maxLength, { error: `Tối đa ${maxLength} ký tự` })

export const optionalText = (maxLength = 500) =>
  z
    .string()
    .trim()
    .max(maxLength, { error: `Tối đa ${maxLength} ký tự` })

export const moneySchema = z
  .number({ error: 'Phải là số' })
  .int({ error: 'Phải là số nguyên' })
  .min(-MAX_MONEY, { error: 'Số tiền quá lớn' })
  .max(MAX_MONEY, { error: 'Số tiền quá lớn' })

export const positiveMoneySchema = moneySchema.refine((value) => value > 0, {
  error: 'Phải lớn hơn 0',
})

export const priceSchema = z
  .number({ error: 'Phải là số' })
  .int({ error: 'Phải là số nguyên' })
  .min(0, { error: 'Không được âm' })
  .max(MAX_PRICE, { error: 'Giá quá lớn' })

export const qtySchema = z
  .number({ error: 'Phải là số' })
  .positive({ error: 'Phải lớn hơn 0' })
  .max(MAX_QTY, { error: 'Số lượng quá lớn' })

export const idSchema = z.string({ error: 'Bắt buộc' }).trim().min(1, { error: 'Bắt buộc' })

export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(30),
  offset: z.coerce.number().int().min(0).default(0),
})
