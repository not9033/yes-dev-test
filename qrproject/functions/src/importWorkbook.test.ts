import assert from 'node:assert/strict'
import test from 'node:test'
import ExcelJS from 'exceljs'
import { parseWorkbook } from './importWorkbook'

async function workbook(rows: unknown[][]): Promise<Buffer> {
  const book = new ExcelJS.Workbook()
  const sheet = book.addWorksheet('Products')
  for (const row of rows) sheet.addRow(row)
  return Buffer.from(await book.xlsx.writeBuffer())
}

test('reports Excel row numbers and keeps duplicate SKUs for ordered updates', async () => {
  const buffer = await workbook([
    ['sku', 'name', 'price', 'category', 'size', 'status'],
    ['LS-0001', 'First', 99.5, 'Serum', '30 ml', ''],
    ['LS-0001', 'Duplicate', 10, '', '', ''],
    ['LS-0002', 'Bad price', 0, '', '', ''],
    ['LS-0003', 'Unknown category', 50, 'Other', '', ''],
  ])
  const rows = await parseWorkbook(buffer, ['Serum'])
  assert.equal(rows.length, 4)
  assert.deepEqual(rows.slice(0, 2).map((row) => [row.rowNumber, row.status, row.reason]), [
    [2, 'valid', ''], [3, 'valid', ''],
  ])
  assert.equal(rows[0].raw?.sku, 'LS-0001')
  assert.equal(rows[1].raw?.sku, 'LS-0001')
  assert.equal(rows[2].status, 'draftReady')
  assert.equal(rows[3].status, 'draftReady')
  assert.match(rows[2].reason, /price/)
  assert.match(rows[3].reason, /category/)
})

test('keeps leading zeroes when SKU is stored as text', async () => {
  const buffer = await workbook([['sku', 'name', 'price'], ['LS-0007', 'Cleanser', 1.25]])
  const rows = await parseWorkbook(buffer, [])
  assert.equal(rows[0].product?.sku, 'LS-0007')
  assert.equal(rows[0].product?.priceSatang, 125)
  assert.equal(rows[0].product?.status, 'active')
})
