import { useMemo, useState } from 'react'
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
import { ledgerRows } from '../lib/debt'
import { fmtMoney, fmtDate, fmtDateTime, todayISO, addDaysISO } from '../lib/format'
import { Card, Badge, Empty, Button, Field, Input } from '../components/ui'
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

  const ledger = useMemo(
    () => (customerId && from <= to ? ledgerRows(customerId, data, from, to) : null),
    [customerId, from, to, data],
  )

  // lần xuất sao kê gần nhất làm mốc đánh dấu
  const lastExport = useMemo(
    () => (customerId ? data.lastExportOf(customerId) : null),
    [customerId, data],
  )

  // đơn sửa SAU lần xuất gần nhất
  const editedOrders = useMemo(() => {
    if (!customerId) return []
    return data.ordersEditedAfter(customerId, lastExport?.exportedAt || null)
  }, [customerId, lastExport, data])

  const editedSet = useMemo(() => new Set(editedOrders.map((o) => o.id)), [editedOrders])

  // chênh lệch tổng của các lần sửa sau mốc xuất
  const totalDiff = useMemo(() => {
    if (!lastExport) return 0
    return editedOrders.reduce(
      (s, o) =>
        s +
        (o.editHistory || [])
          .filter((h) => h.editedAt > lastExport.exportedAt)
          .reduce((x, h) => x + h.diff, 0),
      0,
    )
  }, [editedOrders, lastExport])

  const doExport = (kind) => {
    if (!customerId) return toast.error('Chọn khách trước')
    data.exportStatement({ customerId, from, to })
    toast.success(
      kind === 'pdf'
        ? 'Đã xuất sao kê PDF (giả lập) — đã ghi nhớ lần xuất này'
        : 'Đã xuất sao kê Excel (giả lập) — đã ghi nhớ lần xuất này',
    )
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
      ) : !ledger ? (
        <Card>
          <Empty title="Khoảng ngày không hợp lệ" desc="Ngày bắt đầu phải trước ngày kết thúc" />
        </Card>
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
                const isEdited = r.kind === 'order' && editedSet.has(r.refId)
                const ord = r.kind === 'order' ? data.orders.find((o) => o.id === r.refId) : null
                const latestEdit =
                  isEdited && ord
                    ? (ord.editHistory || [])
                      .filter((h) => !lastExport || h.editedAt > lastExport.exportedAt)
                      .slice(-1)[0]
                    : null
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
                                sửa {fmtDate(latestEdit.editedAt.slice(0, 10))} ·{' '}
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
                Từ sao kê ngày <b>{fmtDate(lastExport.exportedAt.slice(0, 10))}</b> đến nay có{' '}
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

      <PickerModal
        open={custPicker}
        onClose={() => setCustPicker(false)}
        title="Chọn khách hàng"
        items={data.customers}
        getKey={(c) => c.id}
        filterText={(c) => `${c.name} ${c.phone}`}
        onPick={setCustomerId}
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
