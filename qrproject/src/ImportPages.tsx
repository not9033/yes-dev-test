import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, dateTime, json } from './api'
import { ErrorText, Notice, Page, Pill } from './components'
import type { ImportJob, ImportRow } from './types'

export function CategoryAdd({ onAdded }: { onAdded: (categories: string[]) => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  async function submit() { setError(''); try { const result = await api<{ categories: string[] }>('/admin/categories', json('POST', { name })); onAdded(result.categories); setName('') } catch (cause) { setError((cause as Error).message) } }
  return <div className="category-add"><input placeholder="เพิ่มหมวดหมู่ใหม่" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submit() } }} maxLength={60} /><button className="button" type="button" onClick={() => void submit()}>เพิ่มหมวดหมู่</button><ErrorText error={error} /></div>
}

export function ImportPage() {
  const [file, setFile] = useState<File | null>(null)
  const [jobId, setJobId] = useState('')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [summary, setSummary] = useState<ImportJob | null>(null)
  const [categories, setCategories] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<{ categories: string[] }>('/admin/categories').then((data) => setCategories(data.categories)).catch(() => undefined) }, [])
  async function preview() {
    if (!file) return
    setError(''); setBusy(true); setSummary(null); setRows([]); setJobId('')
    try {
      if (!file.name.toLowerCase().endsWith('.xlsx') || file.size > 5 * 1024 * 1024) throw new Error('เลือกไฟล์ .xlsx ขนาดไม่เกิน 5 MB')
      const result = await api<{ id: string; rows: ImportRow[] }>('/admin/imports/preview', { method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'X-File-Name': encodeURIComponent(file.name) }, body: file })
      setJobId(result.id); setRows(result.rows)
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  async function commit() {
    setBusy(true); setError('')
    try {
      let result: ImportJob & { done: boolean }
      do { result = await api<ImportJob & { done: boolean }>(`/admin/imports/${jobId}/commit`, json('POST', {})); setSummary({ ...result, id: jobId }) } while (!result.done)
      const detail = await api<{ rows: ImportRow[] }>(`/admin/imports/${jobId}`)
      setRows(detail.rows)
    } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) }
  }
  const valid = rows.filter((row) => row.status === 'valid' || row.status === 'updateReady').length
  const updates = rows.filter((row) => row.status === 'updateReady').length
  const drafts = rows.filter((row) => row.status === 'draftReady').length
  const invalid = rows.filter((row) => row.status === 'invalid').length
  const skipped = rows.filter((row) => row.status === 'skipped').length
  const categoryErrors = rows.some((row) => row.reason.includes('category: ไม่มีหมวดหมู่'))
  return <Page title="นำเข้าสินค้า" eyebrow="EXCEL IMPORT" actions={<Link className="button" to="/admin/imports">ดูประวัตินำเข้า</Link>}><div className="panel import-panel"><div><p className="eyebrow">STEP 01 / UPLOAD</p><h2>เลือกไฟล์ Excel</h2><p className="muted">.xlsx แผ่นงานแรก · ไม่เกิน 5 MB · สูงสุด 1,000 แถว</p><p className="muted">คอลัมน์บังคับ: sku, name, price · คอลัมน์เสริม: category, size, description, how_to_use, status</p></div><div className="upload-row"><input type="file" accept=".xlsx" onChange={(e) => { setFile(e.target.files?.[0] || null); setRows([]); setJobId(''); setSummary(null) }} /><button className="button primary" disabled={!file || busy} onClick={() => void preview()}>{busy ? 'กำลังตรวจสอบ…' : 'ตรวจสอบไฟล์'}</button></div></div><div className="panel"><div className="section-head"><div><p className="eyebrow">CATEGORIES</p><h2>หมวดหมู่ที่ใช้ได้</h2></div></div><p className="muted">{categories.join(' · ')}</p><CategoryAdd onAdded={setCategories} />{categoryErrors && <p className="muted">แถวที่หมวดหมู่ไม่อยู่ในระบบจะนำเข้าเป็นร่าง inactive เพื่อให้แก้หมวดหมู่ก่อนเปิดขาย</p>}</div><ErrorText error={error} />{rows.length > 0 && <div className="panel"><div className="section-head"><div><p className="eyebrow">STEP 02 / REVIEW</p><h2>ผลการตรวจสอบ</h2></div><div className="summary-chips"><span>{valid} แถวปกติ</span><span>{updates} อัปเดตสินค้าเดิม</span><span>{drafts} ร่าง inactive</span>{invalid > 0 && <span>{invalid} ผิดพลาด</span>}<span>{skipped} ข้าม</span></div></div><div className="table-wrap"><table><thead><tr><th>แถว Excel</th><th>SKU</th><th>ชื่อสินค้า</th><th>สถานะ</th><th>สาเหตุ</th></tr></thead><tbody>{rows.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.product?.sku || row.raw?.sku || '—'}</td><td>{row.product?.name || row.raw?.name || '—'}</td><td><Pill value={row.status} /></td><td>{row.reason || '—'}{row.productId && <> · <Link className="subtle-link" to={`/admin/products/${row.productId}/edit`}>แก้สินค้า</Link></>}</td></tr>)}</tbody></table></div>{summary ? <Notice tone="success">เพิ่ม {summary.imported} · อัปเดต {summary.updated || 0} · ร่าง inactive {summary.inactiveImported || 0} · ข้าม {summary.skipped}</Notice> : <div className="panel-footer"><p className="muted">ยืนยัน {valid} แถวปกติ และ {drafts} แถวเป็นร่าง inactive</p><button className="button primary" disabled={valid + drafts === 0 || busy} onClick={() => void commit()}>{busy ? 'กำลังนำเข้า…' : 'ยืนยันนำเข้า'}</button></div>}</div>}</Page>
}

export function ImportsPage() {
  const [jobs, setJobs] = useState<ImportJob[]>([])
  const [selected, setSelected] = useState<{ job: ImportJob; rows: ImportRow[] } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api<{ imports: ImportJob[] }>('/admin/imports').then((data) => setJobs(data.imports)).catch((cause) => setError(cause.message)) }, [])
  async function open(id: string) { try { const result = await api<{ import: ImportJob; rows: ImportRow[] }>(`/admin/imports/${id}`); setSelected({ job: result.import, rows: result.rows }) } catch (cause) { setError((cause as Error).message) } }
  async function resume() { if (!selected) return; setBusy(true); setError(''); try { let result: ImportJob & { done: boolean }; do { result = await api<ImportJob & { done: boolean }>(`/admin/imports/${selected.job.id}/commit`, json('POST', {})) } while (!result.done); await open(selected.job.id); setJobs((items) => items.map((item) => item.id === selected.job.id ? { ...item, status: 'done', imported: result.imported, updated: result.updated, inactiveImported: result.inactiveImported, skipped: result.skipped, invalid: result.invalid } : item)) } catch (cause) { setError((cause as Error).message) } finally { setBusy(false) } }
  return <Page title="ประวัตินำเข้า" eyebrow="IMPORT HISTORY" actions={<Link className="button primary" to="/admin/products/import">+ นำเข้าใหม่</Link>}><ErrorText error={error} /><div className="panel table-wrap"><table><thead><tr><th>ไฟล์</th><th>วันที่</th><th>สถานะ</th><th>เพิ่ม</th><th>อัปเดต</th><th>ร่าง inactive</th><th>ข้าม</th><th>ผิดพลาด</th><th></th></tr></thead><tbody>{jobs.map((job) => <tr key={job.id}><td><strong>{job.fileName}</strong></td><td>{dateTime(job.createdAt)}</td><td><Pill value={job.status} /></td><td>{job.imported}</td><td>{job.updated || 0}</td><td>{job.inactiveImported || 0}</td><td>{job.skipped}</td><td>{job.invalid}</td><td><button className="text-button" onClick={() => void open(job.id)}>ดูผล</button></td></tr>)}</tbody></table>{!jobs.length && <p className="empty">ยังไม่มีประวัตินำเข้า</p>}</div>{selected && <div className="panel"><div className="section-head"><h2>{selected.job.fileName}</h2>{selected.job.status !== 'done' && <button className="button primary" disabled={busy} onClick={() => void resume()}>{busy ? 'กำลังทำต่อ…' : 'ดำเนินการต่อ'}</button>}</div><div className="table-wrap"><table><thead><tr><th>แถว</th><th>SKU</th><th>ผล</th><th>เหตุผล</th></tr></thead><tbody>{selected.rows.map((row) => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.product?.sku || row.raw?.sku || '—'}</td><td><Pill value={row.status} /></td><td>{row.reason || '—'}{row.productId && <> · <Link className="subtle-link" to={`/admin/products/${row.productId}/edit`}>แก้สินค้า</Link></>}</td></tr>)}</tbody></table></div></div>}</Page>
}
