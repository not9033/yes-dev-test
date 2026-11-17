import { useEffect, useState, type FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import QRCode from 'qrcode'
import { api, json, publicBase } from './api'
import { ErrorText, Loading, Notice, Page, Pill, ProductImage } from './components'
import { storage } from './firebase'
import { newUuid } from './ids'
import { CategoryAdd } from './ImportPages'
import type { Product } from './types'

async function validateImage(file: File): Promise<string> {
  if (file.size > 2 * 1024 * 1024) throw new Error('รูปภาพมีขนาดเกิน 2 MB')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('รับเฉพาะไฟล์ JPG, PNG หรือ WEBP')
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  const png = bytes.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10'
  const webp = String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  if (!(file.type === 'image/jpeg' && jpeg || file.type === 'image/png' && png || file.type === 'image/webp' && webp)) throw new Error('เนื้อไฟล์ไม่ตรงกับประเภท JPG, PNG หรือ WEBP')
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('เปิดรูปภาพไม่ได้') })
  const warning = bitmap.width < 800 || bitmap.height < 800 || bitmap.width !== bitmap.height ? `แนะนำรูปสี่เหลี่ยมจัตุรัสอย่างน้อย 800 × 800 px (รูปนี้ ${bitmap.width} × ${bitmap.height} px)` : ''
  bitmap.close()
  return warning
}

function qrHasContrast(background: string): boolean {
  const rgb = [1, 3, 5].map((index) => parseInt(background.slice(index, index + 2), 16) / 255)
  const luminance = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  return (luminance + 0.05) / 0.0556 >= 4.5
}

export function EditProductPage() {
  const { productId } = useParams()
  const [product, setProduct] = useState<Product | null>(null)
  const [priceText, setPriceText] = useState('')
  const [categories, setCategories] = useState<string[]>([])
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [warning, setWarning] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (productId) api<{ product: Product }>(`/admin/products/${productId}`).then((data) => { setProduct(data.product); setPriceText(String(data.product.priceSatang / 100)) }).catch((cause) => setError(cause.message)); api<{ categories: string[] }>('/admin/categories').then((data) => setCategories(data.categories)).catch(() => undefined) }, [productId])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])
  function update(key: keyof Product, value: string) { setProduct((current) => current ? { ...current, [key]: value } : current); setSaved(false) }
  async function pick(selected?: File) { if (!selected) return; setError(''); try { setWarning(await validateImage(selected)); setFile(selected); setPreviewUrl(URL.createObjectURL(selected)) } catch (cause) { setFile(null); setPreviewUrl(''); setError((cause as Error).message) } }
  async function submit(event: FormEvent) {
    event.preventDefault(); if (!product || !productId) return
    setError(''); setSaved(false); setBusy(true)
    let newPath = ''
    try {
      if (!/^LS-[0-9]{4}$/.test(product.sku.trim().toUpperCase())) throw new Error('SKU ต้องอยู่ในรูปแบบ LS-0000')
      const price = Number(priceText)
      if (!Number.isFinite(price) || price <= 0 || !/^\d+(\.\d{1,2})?$/.test(priceText)) throw new Error('ราคาต้องมากกว่า 0 และมีทศนิยมไม่เกิน 2 ตำแหน่ง')
      if (file) { newPath = `products/${productId}/${newUuid()}`; const imageRef = ref(storage, newPath); await uploadBytes(imageRef, file, { contentType: file.type }); await getDownloadURL(imageRef) }
      await api(`/admin/products/${productId}`, json('PUT', { sku: product.sku, name: product.name, category: product.category, price, size: product.size, description: product.description, how_to_use: product.how_to_use, status: product.status, ...(newPath ? { imagePath: newPath } : {}) }))
      const refreshed = await api<{ product: Product }>(`/admin/products/${productId}`)
      setProduct(refreshed.product); setPriceText(String(refreshed.product.priceSatang / 100)); setFile(null); setPreviewUrl(''); setSaved(true)
    } catch (cause) { if (newPath) await deleteObject(ref(storage, newPath)).catch(() => undefined); setError((cause as Error).message) }
    finally { setBusy(false) }
  }
  if (!product) return <Page title="แก้ไขสินค้า"><ErrorText error={error} /><Loading /></Page>
  return <Page title="แก้ไขสินค้า" eyebrow={product.sku} actions={<div className="row-actions"><Link className="button" to="/admin/products">← รายการสินค้า</Link>{!product.importIssues?.length && <Link className="button" to={`/admin/products/${productId}/qr`}>ดู QR</Link>}</div>}><ErrorText error={error} />{product.importIssues?.length ? <Notice tone="error">ร่าง inactive: {product.importIssues.join('; ')} · ข้อมูลจาก Excel: SKU {String(product.importRaw?.sku || '—')}, ชื่อ {String(product.importRaw?.name || '—')}, ราคา {String(product.importRaw?.price || '—')}, หมวดหมู่ {String(product.importRaw?.category || '—')}</Notice> : null}{saved && <Notice tone="success">บันทึกข้อมูลสินค้าแล้ว QR เดิมยังใช้ลิงก์เดิม</Notice>}<form onSubmit={submit} className="edit-grid"><div className="panel form-panel"><div className="section-head"><h2>ข้อมูลสินค้า</h2><Pill value={product.status} /></div><div className="field-grid"><label>SKU *<input required value={product.sku} onChange={(e) => update('sku', e.target.value)} /></label><label>ชื่อสินค้า *<input required value={product.name} onChange={(e) => update('name', e.target.value)} /></label><label>หมวดหมู่<select value={product.category || ''} onChange={(e) => update('category', e.target.value)}><option value="">ไม่ระบุ</option>{categories.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label>ราคา (บาท) *<input required type="number" min="0.01" step="0.01" value={priceText} onChange={(e) => setPriceText(e.target.value)} /></label><label>ขนาด<input value={product.size || ''} placeholder="เช่น 30 ml, 50 g" onChange={(e) => update('size', e.target.value)} /></label><label>สถานะ<select value={product.status} onChange={(e) => update('status', e.target.value)}><option value="active">เปิดใช้งาน</option><option value="inactive">ปิดใช้งาน</option></select></label></div><label>รายละเอียด<textarea rows={5} value={product.description || ''} onChange={(e) => update('description', e.target.value)} /></label><label>วิธีใช้<textarea rows={4} value={product.how_to_use || ''} onChange={(e) => update('how_to_use', e.target.value)} /></label><CategoryAdd onAdded={setCategories} /><button className="button primary" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'บันทึกสินค้า'}</button></div><div className="panel image-panel"><h2>รูปหลักสินค้า</h2><div className="image-preview"><ProductImage src={previewUrl || product.imageUrl} alt={product.name} /></div><label className="button upload-button">เลือกรูปใหม่<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => void pick(e.target.files?.[0])} /></label><p className="muted">JPG, PNG หรือ WEBP · ไม่เกิน 2 MB</p><p className="muted">แนะนำสี่เหลี่ยมจัตุรัส อย่างน้อย 800 × 800 px</p>{warning && <Notice>{warning}</Notice>}{!product.imageUrl && !file && <Notice>หากยังไม่เพิ่มรูป หน้าสาธารณะจะแสดงรูป placeholder</Notice>}</div></form></Page>
}

export function QrPage() {
  const { productId } = useParams()
  const [product, setProduct] = useState<Product | null>(null)
  const [background, setBackground] = useState('#ffffff')
  const [size, setSize] = useState(512)
  const url = productId ? `${publicBase}/products/${productId}?source=qr` : ''
  const [qr, setQr] = useState('')
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => { if (!productId) return; api<{ product: Product }>(`/admin/products/${productId}`).then((data) => setProduct(data.product)).catch((cause) => setError(cause.message)); api<{ settings: { background: string; size: number } }>(`/admin/products/${productId}/qr`).then((data) => { setBackground(data.settings.background); setSize(data.settings.size) }).catch(() => undefined) }, [productId])
  useEffect(() => { if (!url) return; QRCode.toDataURL(url, { width: size, margin: 4, errorCorrectionLevel: 'H', color: { dark: '#111111', light: background } }).then(setQr).catch((cause) => setError(cause.message)) }, [url, size, background])
  async function save() { setError(''); try { await api(`/admin/products/${productId}/qr`, json('PUT', { background, size })); setSaved(true) } catch (cause) { setError((cause as Error).message) } }
  function download() { if (!qr || !product) return; const anchor = document.createElement('a'); anchor.href = qr; anchor.download = `${product.sku}-qr.png`; anchor.click() }
  return <Page title="QR สินค้า" eyebrow={product?.sku || 'QR CODE'} actions={<Link className="button" to={`/admin/products/${productId}/edit`}>← กลับไปแก้ไขสินค้า</Link>}><ErrorText error={error} />{saved && <Notice tone="success">บันทึกการตั้งค่า QR แล้ว</Notice>}<Notice>QR นี้ใช้ URL ในเครื่องสำหรับทดสอบ เมื่อเผยแพร่บนโดเมนจริงต้องสร้างไฟล์ QR ใหม่ก่อนพิมพ์ใช้งาน</Notice><div className="qr-grid"><div className="panel qr-preview"><p className="eyebrow">SCAN PREVIEW</p>{qr ? <img src={qr} alt={`QR สำหรับ ${product?.name || 'สินค้า'}`} /> : <Loading />}<strong>{product?.name}</strong><code>{url}</code></div><div className="panel form-panel"><h2>ปรับแต่ง QR</h2><label>สีพื้นหลัง<input type="color" value={background} onChange={(e) => { setBackground(e.target.value); setSaved(false) }} /></label>{!qrHasContrast(background) && <Notice tone="error">สีพื้นหลังมืดเกินไป กรุณาเลือกสีอ่อนเพื่อให้ QR สแกนได้</Notice>}<label>ขนาดภาพ<select value={size} onChange={(e) => { setSize(Number(e.target.value)); setSaved(false) }}><option value={256}>256 px</option><option value={512}>512 px</option><option value={1024}>1024 px</option></select></label><div className="button-row"><button className="button" type="button" onClick={() => void save()} disabled={!qrHasContrast(background)}>บันทึกการตั้งค่า</button><button className="button primary" type="button" onClick={download} disabled={!qr || !qrHasContrast(background)}>ดาวน์โหลด PNG</button></div><p className="muted">การปรับสีหรือขนาดไม่เปลี่ยน URL ภายใน QR</p></div></div></Page>
}
