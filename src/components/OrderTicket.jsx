import { forwardRef } from 'react'
import { fmtMoney, fmtDate, fmtQty } from '../lib/format'
import { balanceBeforeOrder } from '../lib/debt'

/**
 * Phiếu HÓA ĐƠN BÁN LẺ — bố cục theo mẫu Excel:
 * Tiêu đề, số phiếu, khách, ngày | bảng SỐ LƯỢNG-QUY CÁCH-SẢN PHẨM-GIÁ-THÀNH TIỀN
 * Cuối: TỔNG ĐƠN HÀNG / CÔNG NỢ CŨ / CÔNG NỢ MỚI (nếu bật trong Cài đặt)
 */
const OrderTicket = forwardRef(function OrderTicket(
  { order, customer, data, showDebt = true, shopName },
  ref,
) {
  const oldDebt = showDebt ? balanceBeforeOrder(customer.id, data, order) : 0
  const newDebt = oldDebt + order.total

  return (
    <div ref={ref} className="ticket-paper mx-auto w-full max-w-[148mm] p-5 text-[13px] leading-snug">
      {/* header */}
      <div className="text-center">
        {shopName && <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">{shopName}</p>}
        <h2 className="mt-0.5 text-[22px] font-extrabold tracking-wide text-slate-900">
          HÓA ĐƠN BÁN LẺ
        </h2>
        <p className="text-[12.5px] font-semibold text-indigo-700">Số phiếu: {order.code}</p>
      </div>

      <div className="mt-3 space-y-0.5 border-y border-dashed border-slate-300 py-2 text-[13px]">
        <p>
          <span className="text-slate-500">Khách hàng: </span>
          <b>{customer.name}</b>
        </p>
        {customer.phone && (
          <p>
            <span className="text-slate-500">Điện thoại: </span>
            {customer.phone}
          </p>
        )}
        {customer.address && (
          <p>
            <span className="text-slate-500">Địa chỉ: </span>
            {customer.address}
          </p>
        )}
        <p>
          <span className="text-slate-500">Ngày: </span>
          <b>{fmtDate(order.date)}</b>
        </p>
      </div>

      {/* bảng dòng hàng — đúng thứ tự cột */}
      <table className="mt-3 w-full border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b-2 border-slate-700 text-left text-[11px] uppercase tracking-wide">
            <th className="py-1.5 pr-1 text-right">Số lượng</th>
            <th className="py-1.5 px-1">Quy cách</th>
            <th className="py-1.5 px-1">Sản phẩm</th>
            <th className="py-1.5 px-1 text-right">Giá</th>
            <th className="py-1.5 pl-1 text-right">Thành tiền</th>
          </tr>
        </thead>
        <tbody>
          {order.lines.map((l) => (
            <tr key={l.id} className="border-b border-dashed border-slate-200">
              <td className="py-1.5 pr-1 text-right tabular-nums">{fmtQty(l.qty)}</td>
              <td className="py-1.5 px-1">{data.units.find((u) => u.id === l.unitId)?.name || ''}</td>
              <td className="py-1.5 px-1 font-medium">
                {data.products.find((p) => p.id === l.productId)?.name || ''}
              </td>
              <td className="py-1.5 px-1 text-right tabular-nums">{fmtMoney(l.price)}</td>
              <td className="py-1.5 pl-1 text-right font-semibold tabular-nums">
                {fmtMoney(l.amount)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {/* tổng kết */}
      <div className="mt-3 space-y-1 border-t-2 border-slate-700 pt-2 text-[13.5px]">
        <div className="flex justify-between">
          <span className="font-semibold">TỔNG ĐƠN HÀNG</span>
          <b className="tabular-nums">{fmtMoney(order.total)} đ</b>
        </div>
        {showDebt && (
          <>
            <div className="flex justify-between text-slate-600">
              <span>CÔNG NỢ CŨ</span>
              <span className="tabular-nums">{fmtMoney(oldDebt)} đ</span>
            </div>
            <div className="flex justify-between rounded-lg bg-slate-100 px-2 py-1.5 text-[14.5px]">
              <span className="font-bold">CÔNG NỢ MỚI</span>
              <b className="tabular-nums">{fmtMoney(newDebt)} đ</b>
            </div>
          </>
        )}
      </div>

      <p className="mt-4 text-center text-[11.5px] italic text-slate-400">
        Cảm ơn quý khách — hẹn gặp lại!
      </p>
    </div>
  )
})

export default OrderTicket
