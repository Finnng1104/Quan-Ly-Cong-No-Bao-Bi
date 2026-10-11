import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authorize, type AppContext } from '../../http/context.js'
import { bpToPercent, percentToBp } from '../../shared/money.js'
import { AppError } from '../../shared/errors.js'
import { nonEmptyText, parseInput } from '../../shared/validation.js'

interface SettingsRow {
  shop_name: string
  vat_rate_bp: number
  show_debt_on_ticket: number
}

const patchSchema = z.object({
  shopName: nonEmptyText(100).optional(),
  vatRatePercent: z.number({ error: 'Phải là số' }).optional(),
  showDebtOnTicket: z.boolean({ error: 'Phải là đúng/sai' }).optional(),
})

function toDto(row: SettingsRow) {
  return {
    shopName: row.shop_name,
    vatRatePercent: bpToPercent(row.vat_rate_bp),
    showDebtOnTicket: row.show_debt_on_ticket === 1,
  }
}

/** The branch's default VAT rate in basis points, used when an order asks for VAT without a rate. */
export function getDefaultVatRateBp(ctx: AppContext, branchId: string): number {
  const row = ctx.db.prepare('SELECT vat_rate_bp FROM settings WHERE branch_id = ?').get(branchId) as
    | { vat_rate_bp: number }
    | undefined
  return row?.vat_rate_bp ?? 800
}

export function registerSettingsRoutes(app: FastifyInstance, ctx: AppContext): void {
  const read = (branchId: string): SettingsRow =>
    ctx.db.prepare('SELECT * FROM settings WHERE branch_id = ?').get(branchId) as SettingsRow

  app.get('/api/settings', async (request) => {
    const { branchId } = authorize(request, 'settings:read')
    return toDto(read(branchId))
  })

  app.patch('/api/settings', async (request) => {
    const { branchId } = authorize(request, 'settings:write')
    const body = parseInput(patchSchema, request.body)

    const current = read(branchId)
    let vatRateBp = current.vat_rate_bp
    if (body.vatRatePercent !== undefined) {
      try {
        vatRateBp = percentToBp(body.vatRatePercent)
      } catch {
        throw new AppError('VALIDATION_ERROR', 'Thuế VAT phải từ 0 đến 100%, tối đa 2 chữ số thập phân', {
          vatRatePercent: 'Từ 0 đến 100, tối đa 2 chữ số thập phân',
        })
      }
    }

    ctx.db
      .prepare(
        `UPDATE settings SET shop_name = ?, vat_rate_bp = ?, show_debt_on_ticket = ? WHERE branch_id = ?`,
      )
      .run(
        body.shopName ?? current.shop_name,
        vatRateBp,
        body.showDebtOnTicket === undefined ? current.show_debt_on_ticket : body.showDebtOnTicket ? 1 : 0,
        branchId,
      )
    return toDto(read(branchId))
  })
}
