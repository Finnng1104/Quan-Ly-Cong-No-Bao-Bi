import { useState } from 'react'
import { createPortal } from 'react-dom'
import { useSearchParams } from 'react-router-dom'
import {
  FileText,
  User,
  FileDown,
  FileSpreadsheet,
  History,
  CalendarDays,
} from 'lucide-react'
import { useStore, customerName } from '../store/useStore'
import { api } from '../api/httpApi'
import { useAsync } from '../hooks/useAsync'
import { useAction } from '../hooks/useAction'
import { fmtMoney, fmtDate, fmtDateTime, todayISO, toISO, addDaysISO, toCsv, downloadText } from '../lib/format'
import { statementCsvRows, statementFileName } from '../lib/statementExport'
import { Card, Badge, Empty, Button, Field, Input } from '../components/ui'
import { ErrorCard, LoadingCard } from '../components/AsyncState'
import { PickerModal, PickerButton, Avatar } from '../components/pickers'
import { useToast } from '../components/Toast'

export default function StatementPage() {
  const [sp] = useSearchParams()
  const [customerId, setCustomerId] = useState(sp.get('khach') || '')
  const [from, setFrom] = useState(addDaysISO(todayISO(), -30))
  const [to, setTo] = useState(todayISO())
  const [custPicker, setCustPicker] = useState(false)
  const data = useStore()
  const toast = useToast()
  const run = useAction()

  const rangeIsValid = from <= to
  // Everything on this page — rows, balances, the "edited since last export" marks and the
  // purchase totals — is computed by the server for the chosen customer and range.
  const { data: statement, error, reload } = useAsync(
    () => (customerId && rangeIsValid ? api.customers.statement(customerId, { from, to }) : null),
    [customerId, from, to, rangeIsValid, data.dataVersion],
  )

  const ledger = statement
    ? { opening: statement.opening, rows: statement.rows, closing: statement.closing }
    : null
  // Timestamps from the server are UTC; dates shown from them go through toISO(new Date(...)) so
  // that an export at 00:11 Vietnam time shows as that day, not the previous UTC day.
  const lastExport = statement?.lastExport ?? null
  const editedOrders = statement?.editedOrders ?? []
  const editedById = new Map(editedOrders.map((o) => [o.id, o]))
  const totalDiff = statement?.totalDiff ?? 0
  const buyStats = statement
    ? { inRange: statement.purchaseTotals.range, year: statement.purchaseTotals.last12Months }
    : null

  const exportExcel = () => {
    const name = customerName(data, customerId)
    downloadText(
      statementFileName(name, { from, to }, 'csv'),
      toCsv(statementCsvRows(statement, { customerName: name, from, to })),
      'text/csv;charset=utf-8',
    )
  }

  const exportPdf = () => {
    // Browsers suggest the page title as the PDF file name.
    const pageTitle = document.title
    document.title = statementFileName(customerName(data, customerId), { from, to }, 'pdf').replace(/\.pdf$/, '')
    window.print()
    document.title = pageTitle
  }

  // The export is recorded only after the file was produced: "edited since last export" marks
  // are measured from that moment, so recording a failed export would hide real changes.
  const doExport = (kind) => {
    if (!customerId) return toast.error('Chọn khách trước')
    if (!statement) return toast.error('Sao kê chưa tải xong')
    if (kind === 'pdf') exportPdf()
    else exportExcel()
    return run(async () => {
      await data.exportStatement(customerId, { from, to })
      toast.success('Đã xuất sao kê — đã ghi nhớ lần xuất này')
    })
  }

  return (
    <div className="animate-fade-up space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Sao kê công nợ</h1>
        <p className="text-[12px] text-slate-400">
          Ngày | Diễn giải | Tăng | Giảm | Dư nợ
        </p>
      </div>

      {/* bộ lọc */}
      <Card className="space-y-3 p-4">
        <Field label="Khách hàng *">
          <PickerButton onClick={() => setCustPicker(true)} placeholder="Chọn khách..." icon={User}>
            {customerId ? customerName(data, customerId) : null}
          </PickerButton>
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Từ ngày">
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="Đến ngày">
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </Field>
        </div>
        {lastExport && (
          <p className="flex items-center gap-1.5 text-[12px] font-semibold text-cyan-700">
            <CalendarDays size={13} />
            Lần xuất sao kê gần nhất: {fmtDateTime(lastExport.exportedAt)}
          </p>
        )}
        {customerId && (
          <div className="grid grid-cols-2 gap-2.5">
            <Button variant="outline" icon={FileDown} onClick={() => doExport('pdf')}>
              Xuất PDF
            </Button>
            <Button variant="outline" icon={FileSpreadsheet} onClick={() => doExport('excel')}>
              Xuất Excel
            </Button>
          </div>
        )}
      </Card>

      {!customerId ? (
        <Card>
          <Empty icon={FileText} title="Chọn khách để xem sao kê" />
        </Card>
      ) : !rangeIsValid ? (
        <Card>
          <Empty title="Khoảng ngày không hợp lệ" desc="Ngày bắt đầu phải trước ngày kết thúc" />
        </Card>
      ) : error && !ledger ? (
        <ErrorCard error={error} onRetry={reload} />
      ) : !ledger ? (
        <LoadingCard />
      ) : (
        <>
          {/* bảng sao kê */}
          <Card className="overflow-hidden">
            {/* header khách */}
            <div className="border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-blue-50 px-4 py-3">
              <p className="text-[14.5px] font-bold text-slate-800">
                {customerName(data, customerId)}
              </p>
              <p className="text-[11.5px] text-slate-500">
                Kỳ {fmtDate(from)} → {fmtDate(to)}
              </p>
              {buyStats && (
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[12px] font-semibold">
                  <span className="text-indigo-700">
                    Hàng lấy trong kỳ: {fmtMoney(buyStats.inRange.total)} đ
                    <span className="ml-1 font-medium text-indigo-400">
                      ({buyStats.inRange.count} đơn)
                    </span>
                  </span>
                  <span className="text-slate-600">
                    Hàng lấy 12 tháng: {fmtMoney(buyStats.year.total)} đ
                    <span className="ml-1 font-medium text-slate-400">
                      ({buyStats.year.count} đơn)
                    </span>
                  </span>
                </div>
              )}
            </div>

            {/* dư đầu khoảng */}
            <div className="flex items-center justify-between bg-slate-50 px-4 py-2.5 text-[13px] font-bold">
              <span className="text-slate-500">Dư đầu kỳ</span>
              <span className="tabular-nums text-slate-700">{fmtMoney(ledger.opening)} đ</span>
            </div>

            {/* header cột — desktop */}
            <div className="hidden grid-cols-[86px_1fr_86px_86px_100px] gap-2 border-b border-slate-100 bg-white px-4 py-2 text-[10.5px] font-bold uppercase tracking-wide text-slate-400 sm:grid">
              <span>Ngày</span>
              <span>Diễn giải</span>
              <span className="text-right">Tăng</span>
              <span className="text-right">Giảm</span>
              <span className="text-right">Dư nợ</span>
            </div>

            <div className="divide-y divide-slate-50">
              {ledger.rows.length === 0 && (
                <Empty title="Không có phát sinh trong kỳ" />
              )}
              {ledger.rows.map((r, i) => {
                const editedInfo = r.kind === 'order' ? editedById.get(r.refId) : undefined
                const isEdited = !!editedInfo
                const latestEdit = editedInfo?.latestEditSinceExport ?? null
                return (
                  <div key={i} className="px-4 py-2.5">
                    {/* mobile: thẻ / desktop: hàng */}
                    <div className="grid grid-cols-[86px_1fr] gap-2 sm:grid-cols-[86px_1fr_86px_86px_100px] sm:items-center">
                      <p className="text-[12.5px] font-bold text-slate-600">{fmtDate(r.date)}</p>
                      <div className="min-w-0">
                        <p className="truncate text-[13.5px] font-semibold text-slate-700">
                          {r.desc}
                        </p>
                        {isEdited && (
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <Badge tone="violet">
                              <History size={10} /> Đã điều chỉnh
                            </Badge>
                            {latestEdit && (
                              <span className="text-[10.5px] font-semibold text-violet-500">
                                sửa {fmtDate(toISO(new Date(latestEdit.editedAt)))} ·{' '}
                                {fmtMoney(latestEdit.oldTotal)} → {fmtMoney(latestEdit.newTotal)} (
                                {latestEdit.diff >= 0 ? '+' : ''}
                                {fmtMoney(latestEdit.diff)})
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="col-span-2 flex items-center justify-end gap-4 sm:contents">
                        <p className="w-[86px] text-right text-[13px] font-bold tabular-nums text-rose-500">
                          {r.up ? `+${fmtMoney(r.up)}` : ''}
                        </p>
                        <p className="w-[86px] text-right text-[13px] font-bold tabular-nums text-emerald-600">
                          {r.down ? `-${fmtMoney(r.down)}` : ''}
                        </p>
                        <p className="w-[100px] text-right text-[13px] font-extrabold tabular-nums text-slate-800">
                          {fmtMoney(r.balance)}
                        </p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* dư cuối kỳ */}
            <div className="flex items-center justify-between border-t-2 border-slate-200 bg-indigo-50/60 px-4 py-3">
              <span className="text-[13.5px] font-bold text-indigo-800">Dư cuối kỳ</span>
              <span className="text-[17px] font-extrabold tabular-nums text-indigo-700">
                {fmtMoney(ledger.closing)} đ
              </span>
            </div>
          </Card>

          {/* tổng kết điều chỉnh sau sao kê gần nhất */}
          {lastExport && (
            <Card className="border-violet-100 bg-violet-50/50 p-4">
              <p className="flex items-center gap-1.5 text-[13px] font-bold text-violet-700">
                <History size={15} /> Điều chỉnh sau sao kê
              </p>
              <p className="mt-1.5 text-[13px] leading-relaxed text-slate-600">
                Từ sao kê ngày <b>{fmtDate(toISO(new Date(lastExport.exportedAt)))}</b> đến nay có{' '}
                <b className="text-violet-700">{editedOrders.length} đơn điều chỉnh</b>, chênh lệch{' '}
                <b className={totalDiff >= 0 ? 'text-rose-500' : 'text-emerald-600'}>
                  {totalDiff >= 0 ? '+' : '-'}
                  {fmtMoney(Math.abs(totalDiff))} đ
                </b>
                .
              </p>
            </Card>
          )}
        </>
      )}

      {/* vùng in cho "Xuất PDF" — bảng đơn giản, chỉ hiện khi in (xem #print-area trong index.css) */}
      {ledger &&
        createPortal(
          <div id="print-area" className="text-[11pt] text-slate-900">
            <h2 className="text-[15pt] font-bold">Sao kê công nợ</h2>
            <p>{data.settings.shopName}</p>
            <p className="mt-2">
              Khách hàng: <b>{customerName(data, customerId)}</b>
            </p>
            <p>
              Kỳ: {fmtDate(from)} → {fmtDate(to)}
            </p>
            <table className="mt-3 w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-slate-800 text-left">
                  <th className="py-1 pr-2">Ngày</th>
                  <th className="py-1 pr-2">Diễn giải</th>
                  <th className="py-1 pr-2 text-right">Tăng</th>
                  <th className="py-1 pr-2 text-right">Giảm</th>
                  <th className="py-1 text-right">Dư nợ</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-slate-300 font-semibold">
                  <td className="py-1 pr-2" colSpan={4}>Dư đầu kỳ</td>
                  <td className="py-1 text-right tabular-nums">{fmtMoney(ledger.opening)}</td>
                </tr>
                {ledger.rows.map((r, i) => (
                  <tr key={i} className="border-b border-slate-200 align-top">
                    <td className="whitespace-nowrap py-1 pr-2">{fmtDate(r.date)}</td>
                    <td className="py-1 pr-2">{r.desc}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{r.up ? fmtMoney(r.up) : ''}</td>
                    <td className="py-1 pr-2 text-right tabular-nums">{r.down ? fmtMoney(r.down) : ''}</td>
                    <td className="py-1 text-right tabular-nums">{fmtMoney(r.balance)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-slate-800 font-bold">
                  <td className="py-1 pr-2" colSpan={4}>Dư cuối kỳ</td>
                  <td className="py-1 text-right tabular-nums">{fmtMoney(ledger.closing)} đ</td>
                </tr>
              </tbody>
            </table>
          </div>,
          document.body,
        )}

      <PickerModal
        open={custPicker}
        onClose={() => setCustPicker(false)}
        title="Chọn khách hàng"
        items={data.customers}
        getKey={(c) => c.id}
        filterText={(c) => `${c.name} ${c.phone}`}
        onPick={(c) => setCustomerId(c.id)}
        renderItem={(c) => (
          <>
            <Avatar name={c.name} />
            <p className="flex-1 text-[14.5px] font-semibold text-slate-800">{c.name}</p>
          </>
        )}
      />
    </div>
  )
}
