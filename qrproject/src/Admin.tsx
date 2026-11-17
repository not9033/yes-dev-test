import { useEffect, useState } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { signOut, type User } from 'firebase/auth'
import { api, baht } from './api'
import { ErrorText, Loading, Page, Pill, ProductImage } from './components'
import { auth } from './firebase'
import type { Dashboard, Product } from './types'
import { ImportPage, ImportsPage } from './ImportPages'
import { EditProductPage, QrPage } from './ProductPages'
import { UsersPage } from './UsersPage'

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' })
const monthAgo = () => { const date = new Date(); date.setDate(date.getDate() - 30); return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' }) }

export function AdminLayout({ user }: { user: User }) {
  const [actor, setActor] = useState<{ role: string; email: string } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<{ actor: { role: string; email: string } }>('/admin/me').then((data) => setActor(data.actor)).catch((cause) => setError(cause.message)) }, [user.uid])
  if (error) return <div className="simple-screen"><div className="auth-card"><ErrorText error={error} /><button className="button" onClick={() => void signOut(auth)}>ออกจากระบบ</button></div></div>
  if (!actor) return <Loading />
  return <div className="admin-layout"><aside className="sidebar"><Link to="/admin" className="sidebar-brand"><span className="brand">LS</span><span>PRODUCT<br />STUDIO</span></Link><p className="nav-caption">WORKSPACE</p><nav><NavLink end to="/admin">ภาพรวม</NavLink><NavLink to="/admin/products">สินค้า</NavLink><NavLink to="/admin/products/import">นำเข้า Excel</NavLink><NavLink to="/admin/imports">ประวัตินำเข้า</NavLink>{actor.role === 'superAdmin' && <NavLink to="/admin/users">ผู้ดูแลระบบ</NavLink>}</nav><div className="sidebar-bottom"><small>{actor.email}</small><button className="text-button" onClick={() => void signOut(auth)}>ออกจากระบบ ↗</button></div></aside><div className="admin-main"><div className="mobile-bar"><Link to="/admin" className="brand">LS</Link><nav><NavLink end to="/admin">ภาพรวม</NavLink><NavLink to="/admin/products">สินค้า</NavLink><NavLink to="/admin/products/import">Import</NavLink><NavLink to="/admin/imports">ประวัติ</NavLink>{actor.role === 'superAdmin' && <NavLink to="/admin/users">Admin</NavLink>}</nav></div><Routes><Route index element={<DashboardPage />} /><Route path="products" element={<ProductsPage />} /><Route path="products/import" element={<ImportPage />} /><Route path="products/:productId/edit" element={<EditProductPage />} /><Route path="products/:productId/qr" element={<QrPage />} /><Route path="imports" element={<ImportsPage />} /><Route path="users" element={actor.role === 'superAdmin' ? <UsersPage /> : <Navigate to="/admin" />} /></Routes></div></div>
}

function DashboardPage() {
  const [from, setFrom] = useState(monthAgo())
  const [to, setTo] = useState(today())
  const [data, setData] = useState<Dashboard | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { api<Dashboard>(`/admin/dashboard?from=${from}&to=${to}`).then(setData).catch((cause) => setError(cause.message)) }, [from, to])
  return <Page title="ภาพรวม" eyebrow="DASHBOARD" actions={<Link className="button primary" to="/admin/products/import">+ นำเข้าสินค้า</Link>}><div className="filter-row"><label>จากวันที่<input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label>ถึงวันที่<input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label></div><ErrorText error={error} />{!data ? <Loading /> : <><div className="stats"><div className="stat"><span>สินค้าทั้งหมด</span><strong>{data.productCount}</strong></div><div className="stat"><span>สินค้าเปิดใช้งาน</span><strong>{data.activeCount}</strong></div><div className="stat"><span>เปิดหน้าผ่านลิงก์ QR</span><strong>{data.scans}</strong></div></div><section className="panel"><div className="section-head"><div><p className="eyebrow">MOST VIEWED</p><h2>สินค้ายอดนิยม 10 อันดับ</h2></div><span className="muted">ตามช่วงวันที่ที่เลือก</span></div>{data.top.length ? <div className="rank-list">{data.top.map((item, index) => <div key={item.id}><span className="rank">{String(index + 1).padStart(2, '0')}</span><Link to={`/admin/products/${item.id}/edit`}>{item.name}</Link><strong>{item.count.toLocaleString('th-TH')}</strong></div>)}</div> : <p className="empty">ยังไม่มีการเปิดหน้าสินค้าผ่าน QR ในช่วงนี้</p>}</section></>}</Page>
}

function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([])
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [error, setError] = useState('')
  useEffect(() => { api<{ products: Product[] }>('/admin/products').then((data) => setProducts(data.products)).catch((cause) => setError(cause.message)) }, [])
  const filtered = products.filter((item) => (status === 'all' || item.status === status) && `${item.sku} ${item.name} ${item.category}`.toLowerCase().includes(search.toLowerCase()))
  return <Page title="สินค้า" eyebrow="CATALOG" actions={<Link className="button primary" to="/admin/products/import">+ นำเข้าจาก Excel</Link>}><div className="toolbar"><input placeholder="ค้นหาชื่อ, SKU หรือหมวดหมู่" value={search} onChange={(e) => setSearch(e.target.value)} /><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">ทุกสถานะ</option><option value="active">เปิดใช้งาน</option><option value="inactive">ปิดใช้งาน</option></select></div><ErrorText error={error} /><div className="panel table-wrap"><table><thead><tr><th>สินค้า</th><th>SKU</th><th>หมวดหมู่</th><th>ราคา</th><th>สถานะ</th><th></th></tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><div className="product-cell"><div className="thumb"><ProductImage src={item.imageUrl} alt="" /></div><strong>{item.name || 'ยังไม่ระบุชื่อสินค้า'}</strong>{item.importIssues?.length ? <small className="muted">ร่างที่ต้องแก้</small> : null}</div></td><td>{item.sku || 'รอแก้ SKU'}</td><td>{item.category || '—'}</td><td>{item.priceSatang > 0 ? baht(item.priceSatang) : 'รอแก้ราคา'}</td><td><Pill value={item.status} /></td><td><div className="row-actions"><Link to={`/admin/products/${item.id}/edit`}>แก้ไข</Link>{!item.importIssues?.length && <Link to={`/admin/products/${item.id}/qr`}>QR</Link>}</div></td></tr>)}</tbody></table>{!filtered.length && <p className="empty">ไม่พบสินค้าที่ตรงกับการค้นหา</p>}</div></Page>
}
