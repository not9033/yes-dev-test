import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { baht } from './api'

const statusText: Record<string, string> = { active: 'เปิดใช้งาน', inactive: 'ปิดใช้งาน', preview: 'รอยืนยัน', processing: 'กำลังนำเข้า', done: 'เสร็จแล้ว', valid: 'พร้อมนำเข้า', updateReady: 'พร้อมอัปเดต', draftReady: 'ร่าง inactive', invalid: 'ผิดพลาด', skipped: 'ข้าม', imported: 'เพิ่มแล้ว', updated: 'อัปเดตแล้ว', importedInactive: 'ร่าง inactive', suspended: 'ระงับแล้ว' }
export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'error' | 'success' }) { return <div className={`notice ${tone}`} role={tone === 'error' ? 'alert' : undefined}>{children}</div> }
export function Page({ title, eyebrow, actions, children }: { title: string; eyebrow?: string; actions?: ReactNode; children: ReactNode }) { return <main className="page"><div className="page-head"><div><p className="eyebrow">{eyebrow || 'LS PRODUCT STUDIO'}</p><h1>{title}</h1></div>{actions}</div>{children}</main> }
export function ErrorText({ error }: { error: string }) { return error ? <Notice tone="error">{error}</Notice> : null }
export function Loading() { return <div className="loading">กำลังโหลดข้อมูล…</div> }
export function Pill({ value }: { value: string }) { return <span className={`pill pill-${value}`}>{statusText[value] || value}</span> }
export function ProductImage({ src, alt }: { src?: string; alt: string }) { return src ? <img className="product-image" src={src} alt={alt} /> : <div className="placeholder" role="img" aria-label="ยังไม่มีรูปสินค้า"><span>LS</span><small>PRODUCT IMAGE</small></div> }
export function BackLink({ to, children }: { to: string; children: ReactNode }) { return <Link className="button" to={to}>← {children}</Link> }
export function Price({ satang }: { satang: number }) { return <>{baht(satang)}</> }
