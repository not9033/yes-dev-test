import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { initializeApp } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { getFirestore } from 'firebase-admin/firestore'

const projectId = 'demo-ls-product-studio'
process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
process.env.FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
process.env.FIREBASE_STORAGE_EMULATOR_HOST = '127.0.0.1:9199'
initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` })
const db = getFirestore()
const auth = getAuth()
const base = `http://127.0.0.1:5001/${projectId}/asia-southeast1/api`

async function request(path, options = {}, token = '') {
  const headers = new Headers(options.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (options.body && typeof options.body === 'string') headers.set('Content-Type', 'application/json')
  const response = await fetch(`${base}${path}`, { ...options, headers })
  return { status: response.status, body: await response.json() }
}

async function idToken(email, password) {
  const response = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
  })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  return body.idToken
}

async function previewRows(rows, fileName, token) {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('products')
  for (const row of rows) sheet.addRow(row)
  return request('/admin/imports/preview', { method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'X-File-Name': fileName }, body: Buffer.from(await workbook.xlsx.writeBuffer()) }, token)
}

test('public product, scan idempotency, role checks and resumable import', async () => {
  const adminUser = await auth.createUser({ email: 'owner@example.test', password: 'test-password-123' })
  const envPath = new URL('./.env', import.meta.url)
  const bootstrapSecret = existsSync(envPath) ? /^BOOTSTRAP_SECRET=(.+)$/m.exec(readFileSync(envPath, 'utf8'))?.[1]?.trim() : undefined
  if (bootstrapSecret) {
    assert.equal((await request('/local/bootstrap', { method: 'POST', body: JSON.stringify({ email: 'owner@example.test' }) })).status, 403)
    const bootstrap = await request('/local/bootstrap', { method: 'POST', headers: { 'X-Bootstrap-Secret': bootstrapSecret }, body: JSON.stringify({ email: 'owner@example.test' }) })
    assert.equal(bootstrap.status, 200, JSON.stringify(bootstrap.body))
  } else {
    await auth.setCustomUserClaims(adminUser.uid, { role: 'superAdmin' })
    await db.doc(`users/${adminUser.uid}`).set({ email: 'owner@example.test', role: 'superAdmin', status: 'active' })
  }
  const token = await idToken('owner@example.test', 'test-password-123')
  const me = await request('/admin/me', {}, token)
  assert.equal(me.status, 200)
  assert.equal((await request('/admin/me')).status, 401)

  await db.doc('products/demo-product').set({ sku: 'LS-9999', name: 'Demo', category: '', priceSatang: 12500, size: '', description: '', how_to_use: '', status: 'active', imageUrl: '' })
  const publicProduct = await request('/public/products/demo-product')
  assert.equal(publicProduct.status, 200)
  assert.equal(publicProduct.body.product.name, 'Demo')
  const eventId = randomUUID()
  const scan = () => request('/public/products/demo-product/scan', { method: 'POST', body: JSON.stringify({ eventId, source: 'qr' }) })
  assert.equal((await request('/public/products/demo-product/scan', { method: 'POST', body: JSON.stringify({ eventId: randomUUID() }) })).status, 400)
  assert.equal((await scan()).body.counted, true)
  assert.equal((await scan()).body.counted, false)
  assert.equal((await db.doc('productStats/demo-product').get()).get('total'), 1)
  await db.doc('products/demo-product').update({ status: 'inactive' })
  assert.equal((await request('/public/products/demo-product')).body.status, 'inactive')
  assert.equal((await request('/public/products/demo-product/scan', { method: 'POST', body: JSON.stringify({ eventId: randomUUID(), source: 'qr' }) })).body.counted, false)

  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('products')
  sheet.addRow(['sku', 'name', 'price', 'category'])
  sheet.addRow(['LS-9001', 'New product', 99.5, 'Serum'])
  const bytes = Buffer.from(await book.xlsx.writeBuffer())
  const preview = await request('/admin/imports/preview', { method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'X-File-Name': 'test.xlsx' }, body: bytes }, token)
  assert.equal(preview.status, 200, JSON.stringify(preview.body))
  assert.equal(preview.body.rows[0].status, 'valid')
  const commit = () => request(`/admin/imports/${preview.body.id}/commit`, { method: 'POST', body: '{}' }, token)
  assert.equal((await commit()).body.imported, 1)
  assert.equal((await commit()).body.imported, 1)
  const imported = await db.collection('products').where('sku', '==', 'LS-9001').get()
  assert.equal(imported.size, 1)
  const importedId = imported.docs[0].id
  const edited = await request(`/admin/products/${importedId}`, { method: 'PUT', body: JSON.stringify({ sku: 'LS-9002', name: 'Updated product', category: 'Serum', price: 100, size: '30 ml', description: '', how_to_use: '', status: 'active' }) }, token)
  assert.equal(edited.status, 200, JSON.stringify(edited.body))
  assert.equal((await request(`/public/products/${importedId}`)).body.product.name, 'Updated product')
  assert.equal((await db.doc('skuIndex/LS-9001').get()).exists, false)
  assert.equal((await db.doc('skuIndex/LS-9002').get()).get('productId'), importedId)

  const unknownCategoryBook = new ExcelJS.Workbook()
  const unknownCategorySheet = unknownCategoryBook.addWorksheet('products')
  unknownCategorySheet.addRow(['sku', 'name', 'price', 'category'])
  unknownCategorySheet.addRow(['LS-9010', 'Needs category', 50, 'Lotion'])
  unknownCategorySheet.addRow(['LS-9011', 'Valid beside error', 50, 'Serum'])
  const unknownCategoryPreview = await request('/admin/imports/preview', { method: 'POST', headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'X-File-Name': 'category.xlsx' }, body: Buffer.from(await unknownCategoryBook.xlsx.writeBuffer()) }, token)
  assert.equal(unknownCategoryPreview.status, 200)
  assert.equal(unknownCategoryPreview.body.rows[0].status, 'draftReady')
  const partialCommit = await request(`/admin/imports/${unknownCategoryPreview.body.id}/commit`, { method: 'POST', body: '{}' }, token)
  assert.equal(partialCommit.status, 200)
  assert.equal(partialCommit.body.imported, 2)
  assert.equal(partialCommit.body.inactiveImported, 1)
  assert.equal((await db.collection('products').where('sku', '==', 'LS-9011').get()).size, 1)
  const categoryDraft = await db.collection('products').where('sku', '==', 'LS-9010').get()
  assert.equal(categoryDraft.size, 1)
  assert.equal(categoryDraft.docs[0].get('status'), 'inactive')
  assert.match(categoryDraft.docs[0].get('importIssues')[0], /category/)
  assert.equal((await request(`/public/products/${categoryDraft.docs[0].id}`)).body.status, 'inactive')

  await db.doc(`products/${importedId}`).update({ imagePath: 'products/test/existing-image', imageUrl: 'https://example.test/existing-image.png' })
  const updatePreview = await previewRows([
    ['sku', 'name', 'price', 'category', 'size', 'description', 'how_to_use', 'status'],
    ['LS-9002', '', '', '', '', 'Updated by Excel', '', ''],
  ], 'update.xlsx', token)
  assert.equal(updatePreview.status, 200)
  assert.equal(updatePreview.body.rows[0].status, 'updateReady')
  assert.equal(updatePreview.body.rows[0].product.name, 'Updated product')
  assert.equal(updatePreview.body.rows[0].product.priceSatang, 10000)
  const updateCommit = await request(`/admin/imports/${updatePreview.body.id}/commit`, { method: 'POST', body: '{}' }, token)
  assert.equal(updateCommit.body.updated, 1)
  assert.equal(updateCommit.body.imported, 0)
  const updatedProduct = await db.doc(`products/${importedId}`).get()
  assert.equal(updatedProduct.get('name'), 'Updated product')
  assert.equal(updatedProduct.get('description'), 'Updated by Excel')
  assert.equal(updatedProduct.get('status'), 'active')
  assert.equal(updatedProduct.get('imagePath'), 'products/test/existing-image')
  assert.equal((await db.doc('skuIndex/LS-9002').get()).get('productId'), importedId)

  const duplicatePreview = await previewRows([
    ['sku', 'name', 'price', 'status'],
    ['LS-9020', 'First version', 60, 'active'],
    ['LS-9020', '', 80, ''],
  ], 'duplicate.xlsx', token)
  assert.equal(duplicatePreview.body.rows[1].status, 'updateReady')
  assert.equal(duplicatePreview.body.rows[1].product.name, 'First version')
  const duplicateCommit = await request(`/admin/imports/${duplicatePreview.body.id}/commit`, { method: 'POST', body: '{}' }, token)
  assert.equal(duplicateCommit.body.imported, 1)
  assert.equal(duplicateCommit.body.updated, 1)
  const oneProduct = await db.collection('products').where('sku', '==', 'LS-9020').get()
  assert.equal(oneProduct.size, 1)
  assert.equal(oneProduct.docs[0].get('priceSatang'), 8000)

  const missingSkuPreview = await previewRows([
    ['sku', 'name', 'price'],
    ['', 'Needs a SKU', 25],
  ], 'draft.xlsx', token)
  assert.equal(missingSkuPreview.body.rows[0].status, 'draftReady')
  const missingSkuCommit = await request(`/admin/imports/${missingSkuPreview.body.id}/commit`, { method: 'POST', body: '{}' }, token)
  assert.equal(missingSkuCommit.body.inactiveImported, 1)
  const missingSkuDraft = await db.collection('products').where('name', '==', 'Needs a SKU').get()
  assert.equal(missingSkuDraft.size, 1)
  assert.equal(missingSkuDraft.docs[0].get('status'), 'inactive')
  assert.equal(missingSkuDraft.docs[0].get('sku'), '')
  const fixedDraft = await request(`/admin/products/${missingSkuDraft.docs[0].id}`, { method: 'PUT', body: JSON.stringify({ sku: 'LS-9040', name: 'Needs a SKU', category: '', price: 25, size: '', description: '', how_to_use: '', status: 'active' }) }, token)
  assert.equal(fixedDraft.status, 200, JSON.stringify(fixedDraft.body))
  assert.equal((await db.doc('skuIndex/LS-9040').get()).get('productId'), missingSkuDraft.docs[0].id)
  assert.equal((await db.doc(`products/${missingSkuDraft.docs[0].id}`).get()).get('importIssues'), undefined)

  const badPricePreview = await previewRows([
    ['sku', 'name', 'price', 'status'],
    ['LS-9002', '', 0, ''],
  ], 'bad-price.xlsx', token)
  assert.equal(badPricePreview.body.rows[0].status, 'draftReady')
  const badPriceCommit = await request(`/admin/imports/${badPricePreview.body.id}/commit`, { method: 'POST', body: '{}' }, token)
  assert.equal(badPriceCommit.body.updated, 1)
  assert.equal(badPriceCommit.body.inactiveImported, 1)
  assert.equal((await db.doc(`products/${importedId}`).get()).get('status'), 'inactive')
  assert.equal((await request(`/public/products/${importedId}`)).body.status, 'inactive')

  const regular = await auth.createUser({ email: 'staff@example.test', password: 'test-password-123' })
  await auth.setCustomUserClaims(regular.uid, { role: 'admin' })
  await db.doc(`users/${regular.uid}`).set({ email: 'staff@example.test', role: 'admin', status: 'active' })
  const staffToken = await idToken('staff@example.test', 'test-password-123')
  assert.equal((await request('/admin/users', {}, staffToken)).status, 403)
  await db.doc(`users/${regular.uid}`).update({ status: 'suspended' })
  assert.equal((await request('/admin/me', {}, staffToken)).status, 403)

  const invitee = await auth.createUser({ email: 'invitee@example.test', password: 'test-password-123' })
  const inviteToken = await idToken('invitee@example.test', 'test-password-123')
  const expiredToken = 'expired-token'
  const inviteId = createHash('sha256').update(expiredToken).digest('hex')
  await db.doc(`invitations/${inviteId}`).set({ email: 'invitee@example.test', status: 'pending', expiresAt: new Date(Date.now() - 1000) })
  assert.equal((await request(`/public/invitations/${expiredToken}`)).body.status, 'expired')
  const expired = await request(`/public/invitations/${expiredToken}/accept`, { method: 'POST', body: '{}' }, inviteToken)
  assert.equal(expired.status, 400)
  assert.equal((await db.doc(`users/${invitee.uid}`).get()).exists, false)
})
