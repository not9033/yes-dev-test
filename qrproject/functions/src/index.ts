import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import express, { type NextFunction, type Request, type Response } from 'express'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth'
import { FieldValue, getFirestore } from 'firebase-admin/firestore'
import { getStorage } from 'firebase-admin/storage'
import { onRequest } from 'firebase-functions/v2/https'
import nodemailer from 'nodemailer'
import { bangkokDay, categoryKey, defaultCategories, draftProduct, mergeImportRow, skuKey, validImageSignature, validateProduct } from './domain'
import { parseWorkbook, type ImportRow } from './importWorkbook'

if (!getApps().length) initializeApp()
const db = getFirestore()
const auth = getAuth()
const bucket = getStorage().bucket()
const app = express()

type Actor = { uid: string; role: 'admin' | 'superAdmin'; email: string }
type AuthedRequest = Request & { actor?: Actor; token?: DecodedIdToken }
const fail = (res: Response, status: number, message: string) => res.status(status).json({ error: message })
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
const isIsoDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

app.use((req, res, next) => {
  const origin = req.headers.origin
  const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((value) => value.trim()).filter(Boolean)
  if (origin && (allowed.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+):5173$/.test(origin))) {
    res.header('Access-Control-Allow-Origin', origin)
    res.header('Vary', 'Origin')
    res.header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-File-Name')
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS')
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.json({ limit: '1mb' }))

app.post('/local/bootstrap', async (req, res) => {
  if (process.env.FUNCTIONS_EMULATOR !== 'true' || !process.env.BOOTSTRAP_SECRET) return fail(res, 404, 'ไม่พบหน้านี้')
  const supplied = req.header('X-Bootstrap-Secret') || ''
  if (!timingSafeEqual(Buffer.from(hash(supplied)), Buffer.from(hash(process.env.BOOTSTRAP_SECRET)))) return fail(res, 403, 'ไม่มีสิทธิ์ตั้งค่าระบบ')
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'อีเมลไม่ถูกต้อง')
  const user = await auth.getUserByEmail(email)
  const existing = await db.collection('users').where('role', '==', 'superAdmin').limit(1).get()
  if (!existing.empty && existing.docs[0].id !== user.uid) return fail(res, 409, 'มี Super Admin อยู่แล้ว')
  await auth.setCustomUserClaims(user.uid, { role: 'superAdmin' })
  await db.doc(`users/${user.uid}`).set({ email, role: 'superAdmin', status: 'active', createdAt: FieldValue.serverTimestamp() }, { merge: true })
  await ensureCategories()
  res.json({ ok: true, uid: user.uid })
})

async function signedIn(req: AuthedRequest, res: Response, next: NextFunction) {
  try {
    const match = /^Bearer (.+)$/.exec(req.header('Authorization') || '')
    if (!match) return fail(res, 401, 'กรุณาเข้าสู่ระบบ')
    req.token = await auth.verifyIdToken(match[1], true)
    next()
  } catch { return fail(res, 401, 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง') }
}

async function admin(req: AuthedRequest, res: Response, next: NextFunction) {
  await signedIn(req, res, async () => {
    try {
      const token = req.token!
      const user = await db.doc(`users/${token.uid}`).get()
      const role = token.role
      if (!user.exists || user.get('status') !== 'active' || !['admin', 'superAdmin'].includes(role) || user.get('role') !== role) {
        return fail(res, 403, 'ไม่มีสิทธิ์ใช้งานส่วนนี้')
      }
      req.actor = { uid: token.uid, role, email: token.email || '' }
      next()
    } catch (error) { next(error) }
  })
}

function superAdmin(req: AuthedRequest, res: Response, next: NextFunction) {
  if (req.actor?.role !== 'superAdmin') return fail(res, 403, 'เฉพาะ Super Admin')
  next()
}

let categoriesReady: Promise<void> | null = null
function ensureCategories(): Promise<void> {
  if (!categoriesReady) categoriesReady = (async () => {
    const batch = db.batch()
    for (const name of defaultCategories) batch.set(db.doc(`categories/${categoryKey(name)}`), { name, createdAt: FieldValue.serverTimestamp() }, { merge: true })
    await batch.commit()
  })().catch((error) => { categoriesReady = null; throw error })
  return categoriesReady
}
async function categoryList(): Promise<string[]> {
  await ensureCategories()
  return (await db.collection('categories').get()).docs.map((doc) => String(doc.get('name'))).sort()
}

app.get('/public/products/:id', async (req, res) => {
  const product = await db.doc(`products/${req.params.id}`).get()
  if (!product.exists) return fail(res, 404, 'ไม่พบสินค้า')
  if (product.get('status') !== 'active') return res.json({ status: 'inactive' })
  const { sku, name, category, priceSatang, size, description, how_to_use, imageUrl } = product.data()!
  res.json({ status: 'active', product: { id: product.id, sku, name, category, priceSatang, size, description, how_to_use, imageUrl: imageUrl || '' } })
})

app.post('/public/products/:id/scan', async (req, res) => {
  const { eventId, source } = req.body || {}
  if (source !== 'qr') return fail(res, 400, 'นับยอดเปิดเฉพาะลิงก์ QR')
  if (typeof eventId !== 'string' || !/^[0-9a-f-]{36}$/i.test(eventId)) return fail(res, 400, 'รหัสเหตุการณ์ไม่ถูกต้อง')
  const productId = req.params.id
  const day = bangkokDay()
  const minute = Math.floor(Date.now() / 60000)
  const ip = req.ip || req.socket.remoteAddress || 'unknown'
  const rateKey = hash(`${process.env.SCAN_RATE_SALT || 'dev-only'}:${ip}:${minute}`)
  try {
    const counted = await db.runTransaction(async (tx) => {
      const eventRef = db.doc(`scanLogs/${eventId}`)
      const productRef = db.doc(`products/${productId}`)
      const rateRef = db.doc(`scanRate/${rateKey}`)
      const totalRef = db.doc(`productStats/${productId}`)
      const dailyRef = db.doc(`scanDaily/${day}_${productId}`)
      const [event, product, rate] = await Promise.all([tx.get(eventRef), tx.get(productRef), tx.get(rateRef)])
      if (event.exists || !product.exists || product.get('status') !== 'active') return false
      if ((rate.get('count') || 0) >= 30) return false
      tx.create(eventRef, { productId, source: 'qr', day, createdAt: FieldValue.serverTimestamp() })
      tx.set(rateRef, { count: FieldValue.increment(1), expiresAt: new Date(Date.now() + 120000) }, { merge: true })
      tx.set(totalRef, { total: FieldValue.increment(1), productId }, { merge: true })
      tx.set(dailyRef, { count: FieldValue.increment(1), day, productId }, { merge: true })
      return true
    })
    res.json({ counted })
  } catch { res.json({ counted: false }) }
})

app.get('/admin/categories', admin, async (_req, res) => res.json({ categories: await categoryList() }))
app.get('/admin/me', admin, async (req, res) => res.json({ actor: (req as AuthedRequest).actor }))
app.post('/admin/categories', admin, async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : ''
  if (!name || name.length > 60 || name.includes('/')) return fail(res, 400, 'ชื่อหมวดหมู่ต้องมี 1–60 ตัวอักษรและไม่มี /')
  const ref = db.doc(`categories/${categoryKey(name)}`)
  await db.runTransaction(async (tx) => {
    if ((await tx.get(ref)).exists) throw new Error('หมวดหมู่นี้มีอยู่แล้ว')
    tx.create(ref, { name, createdBy: (req as AuthedRequest).actor!.uid, createdAt: FieldValue.serverTimestamp() })
  })
  res.json({ categories: await categoryList() })
})

app.get('/admin/products', admin, async (_req, res) => {
  const docs = await db.collection('products').orderBy('updatedAt', 'desc').get()
  res.json({ products: docs.docs.map((doc) => ({ id: doc.id, ...doc.data() })) })
})
app.get('/admin/products/:id', admin, async (req, res) => {
  const doc = await db.doc(`products/${req.params.id}`).get()
  if (!doc.exists) return fail(res, 404, 'ไม่พบสินค้า')
  res.json({ product: { id: doc.id, ...doc.data() } })
})
app.put('/admin/products/:id', admin, async (req, res) => {
  const productId = req.params.id
  let input
  try { input = validateProduct(req.body || {}, await categoryList()) } catch (error) { return fail(res, 400, (error as Error).message) }
  const nextImagePath = req.body?.imagePath
  if (nextImagePath !== undefined && nextImagePath !== null && (typeof nextImagePath !== 'string' || !new RegExp(`^products/${productId}/[a-f0-9-]{36}$`).test(nextImagePath))) {
    return fail(res, 400, 'ตำแหน่งไฟล์รูปไม่ถูกต้อง')
  }
  let imageUrl = ''
  if (typeof nextImagePath === 'string') {
    const [metadata] = await bucket.file(nextImagePath).getMetadata().catch(() => { throw new Error('ไม่พบรูปที่อัปโหลด') })
    if (Number(metadata.size) > 2 * 1024 * 1024 || !['image/jpeg', 'image/png', 'image/webp'].includes(metadata.contentType || '')) return fail(res, 400, 'รูปมีประเภทหรือขนาดไม่ถูกต้อง')
    const [header] = await bucket.file(nextImagePath).download({ start: 0, end: 11 })
    if (!validImageSignature(header, metadata.contentType || '')) return fail(res, 400, 'เนื้อไฟล์รูปไม่ตรงกับประเภท JPG, PNG หรือ WEBP')
    const token = String(metadata.metadata?.firebaseStorageDownloadTokens || '').split(',')[0]
    if (!token) return fail(res, 400, 'ไม่สามารถสร้าง URL รูปได้')
    imageUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(nextImagePath)}?alt=media&token=${token}`
  }
  let previousPath = ''
  await db.runTransaction(async (tx) => {
    const ref = db.doc(`products/${productId}`)
    const current = await tx.get(ref)
    if (!current.exists) throw new Error('ไม่พบสินค้า')
    const oldSku = skuKey(String(current.get('sku')))
    const newRef = db.doc(`skuIndex/${input.sku}`)
    const existing = oldSku === input.sku ? null : await tx.get(newRef)
    if (existing?.exists) throw new Error('SKU นี้มีอยู่แล้ว')
    previousPath = current.get('imagePath') || ''
    if (oldSku !== input.sku) {
      if (oldSku) tx.delete(db.doc(`skuIndex/${oldSku}`))
      tx.create(newRef, { productId })
    }
    tx.update(ref, { ...input, importIssues: FieldValue.delete(), importRaw: FieldValue.delete(), ...(nextImagePath !== undefined ? { imagePath: nextImagePath || '', imageUrl } : {}), updatedAt: FieldValue.serverTimestamp(), updatedBy: (req as AuthedRequest).actor!.uid })
  })
  if (nextImagePath !== undefined && previousPath && previousPath !== nextImagePath) await bucket.file(previousPath).delete({ ignoreNotFound: true }).catch(() => undefined)
  res.json({ ok: true })
})

app.get('/admin/products/:id/qr', admin, async (req, res) => {
  const doc = await db.doc(`qrSettings/${req.params.id}`).get()
  res.json({ settings: doc.exists ? doc.data() : { background: '#ffffff', size: 512 } })
})
app.put('/admin/products/:id/qr', admin, async (req, res) => {
  const { background, size } = req.body || {}
  if (typeof background !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(background) || ![256, 512, 1024].includes(size)) return fail(res, 400, 'สีหรือขนาด QR ไม่ถูกต้อง')
  const rgb = [1, 3, 5].map((index) => parseInt(background.slice(index, index + 2), 16) / 255)
  const luminance = rgb.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
  if ((luminance + 0.05) / 0.0556 < 4.5) return fail(res, 400, 'สีพื้นหลังมืดเกินไปสำหรับจุด QR สีเข้ม')
  await db.doc(`qrSettings/${req.params.id}`).set({ background, size, updatedBy: (req as AuthedRequest).actor!.uid, updatedAt: FieldValue.serverTimestamp() })
  res.json({ ok: true })
})

app.get('/admin/imports', admin, async (_req, res) => {
  const docs = await db.collection('imports').orderBy('createdAt', 'desc').limit(100).get()
  res.json({ imports: docs.docs.map((doc) => ({ id: doc.id, ...doc.data() })) })
})
app.get('/admin/imports/:id', admin, async (req, res) => {
  const ref = db.doc(`imports/${req.params.id}`)
  const [doc, rows] = await Promise.all([ref.get(), ref.collection('rows').orderBy('rowNumber').get()])
  if (!doc.exists) return fail(res, 404, 'ไม่พบงานนำเข้า')
  res.json({ import: { id: doc.id, ...doc.data() }, rows: rows.docs.map((row) => row.data()) })
})
app.post('/admin/imports/preview', admin, express.raw({ type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', limit: '5mb' }), async (req, res) => {
  if (!Buffer.isBuffer(req.body)) return fail(res, 400, 'กรุณาเลือกไฟล์ .xlsx')
  const fileName = decodeURIComponent(req.header('X-File-Name') || 'products.xlsx')
  if (!fileName.toLowerCase().endsWith('.xlsx')) return fail(res, 400, 'รองรับเฉพาะไฟล์ .xlsx')
  let rows: ImportRow[]
  const categories = await categoryList()
  try { rows = await parseWorkbook(req.body, categories) } catch (error) { return fail(res, 400, (error as Error).message) }
  const keys = [...new Set(rows.map((row) => typeof row.raw?.sku === 'string' ? skuKey(row.raw.sku) : '').filter((key) => /^LS-[0-9]{4}$/.test(key)))]
  const simulated = new Map<string, Record<string, unknown>>()
  for (let offset = 0; offset < keys.length; offset += 100) {
    const refs = keys.slice(offset, offset + 100).map((key) => db.doc(`skuIndex/${key}`))
    const snapshots = await db.getAll(...refs)
    const indexed = snapshots.filter((item) => item.exists)
    if (!indexed.length) continue
    const products = await db.getAll(...indexed.map((item) => db.doc(`products/${item.get('productId')}`)))
    products.forEach((product, index) => { if (product.exists) simulated.set(indexed[index].id, product.data()!) })
  }
  for (const row of rows) {
    const sku = typeof row.raw?.sku === 'string' ? skuKey(row.raw.sku) : ''
    if (!/^LS-[0-9]{4}$/.test(sku) || !row.raw) continue
    const previous = simulated.get(sku)
    if (!previous) {
      simulated.set(sku, row.product ? { ...row.product } : draftProduct(row.raw, categories, row.reason))
      continue
    }
    const merged = mergeImportRow(row.raw, previous)
    try {
      const product = validateProduct(merged, categories)
      row.status = 'updateReady'
      row.reason = 'SKU นี้มีอยู่แล้ว จะอัปเดตสินค้าเดิม โดยเซลล์ว่างใช้ค่าเดิม'
      row.product = product
      simulated.set(sku, { ...product })
    } catch (error) {
      row.status = 'draftReady'
      row.reason = (error as Error).message
      delete row.product
      simulated.set(sku, draftProduct(merged, categories, row.reason))
    }
  }
  const ref = db.collection('imports').doc()
  await ref.set({ fileName, createdBy: (req as AuthedRequest).actor!.uid, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp(), status: 'preview', cursor: 1, total: rows.length, imported: 0, updated: 0, inactiveImported: 0, invalid: rows.filter((row) => row.status === 'invalid').length, skipped: rows.filter((row) => row.status === 'skipped').length })
  const writer = db.bulkWriter()
  for (const row of rows) writer.set(ref.collection('rows').doc(String(row.rowNumber)), row)
  await writer.close()
  res.json({ id: ref.id, rows })
})
app.post('/admin/imports/:id/commit', admin, async (req, res) => {
  const ref = db.doc(`imports/${req.params.id}`)
  const job = await ref.get()
  if (!job.exists) return fail(res, 404, 'ไม่พบงานนำเข้า')
  if (job.get('status') === 'done') return res.json({ done: true, ...job.data() })
  const categories = await categoryList()
  const rows = await ref.collection('rows').where('rowNumber', '>', job.get('cursor') || 1).orderBy('rowNumber').limit(25).get()
  for (const rowDoc of rows.docs) {
    const row = rowDoc.data() as ImportRow
    await db.runTransaction(async (tx) => {
      const [currentJob, currentRow] = await Promise.all([tx.get(ref), tx.get(rowDoc.ref)])
      const currentStatus = currentRow.get('status') as ImportRow['status']
      if (!currentJob.exists || row.rowNumber <= (currentJob.get('cursor') || 1) || ['imported', 'updated', 'importedInactive'].includes(currentStatus)) return
      const progress = { cursor: row.rowNumber, status: 'processing', updatedAt: FieldValue.serverTimestamp() }
      if (!['valid', 'updateReady', 'draftReady'].includes(currentStatus)) { tx.update(ref, progress); return }
      const source = row.raw || (row.product ? { ...row.product, price: row.product.priceSatang / 100 } : null)
      if (!source) {
        tx.update(rowDoc.ref, { status: 'invalid', reason: 'ไม่พบข้อมูลแถวสำหรับสร้างร่าง กรุณาตรวจสอบไฟล์ใหม่' })
        tx.update(ref, { ...progress, invalid: FieldValue.increment(1) })
        return
      }
      const sourceSku = typeof source.sku === 'string' ? skuKey(source.sku) : ''
      const skuRef = /^LS-[0-9]{4}$/.test(sourceSku) ? db.doc(`skuIndex/${sourceSku}`) : null
      const sku = skuRef ? await tx.get(skuRef) : null
      const existingRef = sku?.exists ? db.doc(`products/${sku.get('productId')}`) : null
      const existing = existingRef ? await tx.get(existingRef) : null
      if (existingRef && !existing?.exists) throw new Error('SKU ชี้ไปยังสินค้าที่ไม่พบ กรุณาตรวจสอบข้อมูลใน Firestore')
      const merged = mergeImportRow(source, existing?.data())
      let isDraft = false
      let reason = ''
      let input
      try { input = validateProduct(merged, categories) }
      catch (error) { isDraft = true; reason = (error as Error).message; input = draftProduct(merged, categories, reason) }
      const categoryRef = !isDraft && input.category ? db.doc(`categories/${categoryKey(input.category)}`) : null
      if (categoryRef && !(await tx.get(categoryRef)).exists) {
        isDraft = true
        reason = 'category: หมวดหมู่ถูกลบจากระบบ'
        input = { ...draftProduct(merged, categories, reason), category: '' }
      }
      const productRef = existingRef || db.collection('products').doc()
      const actorId = (req as AuthedRequest).actor!.uid
      const fields = { ...input, importJobId: ref.id, importRowNumber: row.rowNumber, updatedAt: FieldValue.serverTimestamp(), updatedBy: actorId }
      if (existingRef) {
        tx.update(productRef, { ...fields, ...(!isDraft ? { importIssues: FieldValue.delete(), importRaw: FieldValue.delete() } : {}) })
      } else {
        tx.create(productRef, { productId: productRef.id, ...fields, imagePath: '', imageUrl: '', createdAt: FieldValue.serverTimestamp(), createdBy: actorId })
        if (skuRef) tx.create(skuRef, { productId: productRef.id })
      }
      const result = isDraft ? 'importedInactive' : existingRef ? 'updated' : 'imported'
      if (!isDraft) reason = existingRef ? 'SKU นี้มีอยู่แล้ว อัปเดตสินค้าเดิม โดยเซลล์ว่างใช้ค่าเดิม' : ''
      tx.update(rowDoc.ref, { status: result, reason, productId: productRef.id, productAction: existingRef ? 'updated' : 'created' })
      tx.update(ref, { ...progress, ...(existingRef ? { updated: FieldValue.increment(1) } : { imported: FieldValue.increment(1) }), ...(isDraft ? { inactiveImported: FieldValue.increment(1) } : {}) })
    })
  }
  const latest = await ref.get()
  const remaining = await ref.collection('rows').where('rowNumber', '>', latest.get('cursor') || 1).orderBy('rowNumber').limit(1).get()
  if (remaining.empty) await ref.update({ status: 'done', updatedAt: FieldValue.serverTimestamp() })
  const final = await ref.get()
  res.json({ done: final.get('status') === 'done', ...final.data() })
})

app.get('/admin/dashboard', admin, async (req, res) => {
  const from = req.query.from, to = req.query.to
  if (!isIsoDay(from) || !isIsoDay(to) || from > to) return fail(res, 400, 'ช่วงวันที่ไม่ถูกต้อง')
  const [products, days] = await Promise.all([
    db.collection('products').get(),
    db.collection('scanDaily').where('day', '>=', from).where('day', '<=', to).get(),
  ])
  const totals = new Map<string, number>()
  for (const day of days.docs) totals.set(day.get('productId'), (totals.get(day.get('productId')) || 0) + Number(day.get('count') || 0))
  const names = new Map(products.docs.map((product) => [product.id, product.get('name')]))
  const top = [...totals].map(([id, count]) => ({ id, name: names.get(id) || id, count })).sort((a, b) => b.count - a.count).slice(0, 10)
  res.json({ productCount: products.size, activeCount: products.docs.filter((item) => item.get('status') === 'active').length, scans: [...totals.values()].reduce((a, b) => a + b, 0), top })
})

app.get('/public/invitations/:token', async (req, res) => {
  const doc = await db.doc(`invitations/${hash(String(req.params.token))}`).get()
  if (!doc.exists) return fail(res, 404, 'ไม่พบคำเชิญ')
  const status = doc.get('status') === 'pending' && doc.get('expiresAt').toMillis() < Date.now() ? 'expired' : doc.get('status')
  res.json({ email: doc.get('email'), status, expiresAt: doc.get('expiresAt') })
})
app.get('/admin/users', admin, superAdmin, async (_req, res) => {
  const docs = await db.collection('users').get()
  res.json({ users: docs.docs.map((doc) => ({ uid: doc.id, ...doc.data() })) })
})
app.post('/admin/invitations', admin, superAdmin, async (req, res) => {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail(res, 400, 'อีเมลไม่ถูกต้อง')
  try {
    const authUser = await auth.getUserByEmail(email)
    if ((await db.doc(`users/${authUser.uid}`).get()).exists) return fail(res, 409, 'อีเมลนี้มีบัญชีผู้ดูแลแล้ว')
  } catch (error) { if ((error as { code?: string }).code !== 'auth/user-not-found') throw error }
  const existing = await db.collection('invitations').where('email', '==', email).get()
  const batch = db.batch()
  for (const old of existing.docs) if (old.get('status') === 'pending') batch.update(old.ref, { status: 'cancelled' })
  const token = randomBytes(32).toString('hex')
  batch.create(db.doc(`invitations/${hash(token)}`), { email, status: 'pending', invitedBy: (req as AuthedRequest).actor!.uid, createdAt: FieldValue.serverTimestamp(), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) })
  await batch.commit()
  const base = process.env.PUBLIC_BASE_URL || 'http://localhost:5173'
  const link = `${base.replace(/\/$/, '')}/accept-invite?token=${token}`
  if (process.env.MAILTRAP_HOST && process.env.MAILTRAP_USER && process.env.MAILTRAP_PASSWORD) {
    const mailer = nodemailer.createTransport({ host: process.env.MAILTRAP_HOST, port: Number(process.env.MAILTRAP_PORT || 2525), auth: { user: process.env.MAILTRAP_USER, pass: process.env.MAILTRAP_PASSWORD } })
    await mailer.sendMail({ from: process.env.MAIL_FROM || 'no-reply@example.test', to: email, subject: 'คำเชิญเป็น Admin', text: `เปิดลิงก์นี้เพื่อตั้งรหัสผ่านภายใน 24 ชั่วโมง: ${link}` })
  } else if (process.env.FUNCTIONS_EMULATOR === 'true') {
    console.info(`Development invitation for ${email}: ${link}`)
  } else {
    return fail(res, 503, 'ยังไม่ได้ตั้งค่าผู้ส่งอีเมล')
  }
  res.json({ ok: true })
})
app.post('/public/invitations/:token/accept', signedIn, async (req: AuthedRequest, res) => {
  const uid = req.token!.uid
  const email = req.token!.email?.toLowerCase()
  const inviteRef = db.doc(`invitations/${hash(String(req.params.token))}`)
  const userRef = db.doc(`users/${uid}`)
  await db.runTransaction(async (tx) => {
    const [invite, user] = await Promise.all([tx.get(inviteRef), tx.get(userRef)])
    if (!invite.exists || invite.get('email') !== email) throw new Error('คำเชิญไม่ตรงกับบัญชีนี้')
    if (invite.get('status') === 'accepted' && invite.get('acceptedUid') === uid && user.exists) return
    if (invite.get('status') !== 'pending') throw new Error('คำเชิญถูกใช้หรือยกเลิกแล้ว')
    if (invite.get('expiresAt').toMillis() < Date.now()) throw new Error('คำเชิญหมดอายุแล้ว')
    tx.update(inviteRef, { status: 'accepted', acceptedUid: uid, acceptedAt: FieldValue.serverTimestamp() })
    tx.set(userRef, { email, role: 'admin', status: 'pending', createdAt: FieldValue.serverTimestamp() })
  })
  await auth.setCustomUserClaims(uid, { role: 'admin' })
  await userRef.update({ status: 'active' })
  res.json({ ok: true })
})
app.post('/admin/users/:uid/suspend', admin, superAdmin, async (req, res) => {
  const ref = db.doc(`users/${req.params.uid}`)
  const user = await ref.get()
  if (!user.exists || user.get('role') !== 'admin') return fail(res, 400, 'ระงับได้เฉพาะบัญชี Admin')
  await ref.update({ status: 'suspended', updatedAt: FieldValue.serverTimestamp() })
  await auth.updateUser(String(req.params.uid), { disabled: true })
  await auth.revokeRefreshTokens(String(req.params.uid))
  res.json({ ok: true })
})

app.use((error: unknown, _req: Request, res: Response, next: NextFunction) => {
  void next
  const message = error instanceof Error ? error.message : 'เกิดข้อผิดพลาด'
  console.error(error)
  if (message.includes('request entity too large')) return fail(res, 413, 'ไฟล์มีขนาดเกิน 5 MB')
  if (message.includes('SKU') || message.includes('หมวดหมู่') || message.includes('คำเชิญ') || message.includes('สินค้า')) return fail(res, 400, message)
  return fail(res, 500, 'ระบบขัดข้อง กรุณาลองอีกครั้ง')
})

export const api = onRequest({ region: 'asia-southeast1', timeoutSeconds: 120, memory: '512MiB' }, app)
