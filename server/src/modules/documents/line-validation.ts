import type { AppContext } from '../../http/context.js'
import { AppError } from '../../shared/errors.js'
import { MoneyError, toQtyMilli } from '../../shared/money.js'

export function fieldError(field: string, message: string): AppError {
  return new AppError('VALIDATION_ERROR', message, { [field]: message })
}

/** Items a previous version of the same document already used; they may be soft-deleted. */
export interface ReusableItems {
  productIds: ReadonlySet<string>
  unitIds: ReadonlySet<string>
}

/**
 * Checks that the product and unit of a line exist and are not deleted (unless the document
 * already used them), and converts the quantity to milli-units. `prefix` names the field in errors,
 * for example `lines[2]`.
 */
export function validateLineItem(
  ctx: AppContext,
  branchId: string,
  line: { productId: string; unitId: string; qty: number },
  prefix: string,
  reusable: ReusableItems | null,
): number {
  const product = ctx.db
    .prepare('SELECT deleted_at FROM products WHERE id = ? AND branch_id = ?')
    .get(line.productId, branchId) as { deleted_at: string | null } | undefined
  if (!product || (product.deleted_at && !reusable?.productIds.has(line.productId))) {
    throw fieldError(`${prefix}.productId`, 'Sản phẩm không tồn tại')
  }

  const unit = ctx.db
    .prepare('SELECT deleted_at FROM units WHERE id = ? AND branch_id = ?')
    .get(line.unitId, branchId) as { deleted_at: string | null } | undefined
  if (!unit || (unit.deleted_at && !reusable?.unitIds.has(line.unitId))) {
    throw fieldError(`${prefix}.unitId`, 'Quy cách không tồn tại')
  }

  let qtyMilli: number
  try {
    qtyMilli = toQtyMilli(line.qty)
  } catch (error) {
    if (error instanceof MoneyError) throw fieldError(`${prefix}.qty`, 'Số lượng tối đa 3 chữ số thập phân')
    throw error
  }
  if (qtyMilli <= 0) throw fieldError(`${prefix}.qty`, 'Phải lớn hơn 0')
  return qtyMilli
}
