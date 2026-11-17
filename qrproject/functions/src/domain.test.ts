import assert from 'node:assert/strict'
import test from 'node:test'
import { bangkokDay, draftProduct, mergeImportRow, parsePrice, validImageSignature, validateProduct } from './domain'

test('validates product defaults and baht conversion', () => {
  const result = validateProduct({ sku: 'ls-0001', name: 'Serum', price: 129.5 }, ['Serum'])
  assert.equal(result.sku, 'LS-0001')
  assert.equal(result.priceSatang, 12950)
  assert.equal(result.status, 'active')
})

test('rejects invalid SKU, category and price', () => {
  assert.throws(() => validateProduct({ sku: 'LS-1', name: 'A', price: 1 }, []), /sku/)
  assert.throws(() => validateProduct({ sku: 'LS-0001', name: 'A', price: 1, category: 'Other' }, []), /category/)
  assert.throws(() => parsePrice(0), /price/)
  assert.throws(() => parsePrice(1.234), /price/)
})

test('uses Bangkok date at UTC boundary', () => {
  assert.equal(bangkokDay(new Date('2026-01-01T18:00:00Z')), '2026-01-02')
})

test('checks image content instead of trusting MIME alone', () => {
  assert.equal(validImageSignature(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'image/png'), true)
  assert.equal(validImageSignature(Buffer.from('not an image'), 'image/png'), false)
})

test('keeps existing fields for empty Excel cells and makes incomplete rows inactive drafts', () => {
  const merged = mergeImportRow({ sku: 'LS-0009', name: '', price: '', category: '', size: '', description: 'New text', how_to_use: '', status: '' }, {
    sku: 'LS-0009', name: 'Old name', priceSatang: 12950, category: 'Serum', size: '30 ml', description: 'Old text', how_to_use: 'Apply daily', status: 'inactive',
  })
  assert.equal(merged.name, 'Old name')
  assert.equal(merged.price, 129.5)
  assert.equal(merged.status, 'inactive')
  assert.equal(merged.description, 'New text')
  const draft = draftProduct({ sku: '', name: '', price: 0, category: 'Unknown', size: '', description: '', how_to_use: '', status: 'active' }, ['Serum'], 'sku: ต้องเป็นข้อความและห้ามว่าง')
  assert.equal(draft.status, 'inactive')
  assert.equal(draft.sku, '')
  assert.equal(draft.priceSatang, 0)
  assert.deepEqual(draft.importIssues, ['sku: ต้องเป็นข้อความและห้ามว่าง'])
})
