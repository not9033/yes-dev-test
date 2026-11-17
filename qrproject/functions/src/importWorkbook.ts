import ExcelJS from 'exceljs'
import { validateProduct, type ImportRaw, type ProductInput } from './domain'

export type ImportRow = {
  rowNumber: number
  status: 'valid' | 'updateReady' | 'draftReady' | 'invalid' | 'skipped' | 'imported' | 'updated' | 'importedInactive'
  reason: string
  product?: ProductInput
  raw?: ImportRaw
}

const columns = ['sku', 'name', 'category', 'price', 'size', 'description', 'how_to_use', 'status'] as const
const required = ['sku', 'name', 'price']

function textCell(cell: ExcelJS.Cell): unknown {
  if (cell.value === null) return ''
  return typeof cell.value === 'string' ? cell.value : cell.value
}

export async function parseWorkbook(buffer: Buffer, categories: string[]): Promise<ImportRow[]> {
  if (!buffer.length || buffer.length > 5 * 1024 * 1024) throw new Error('ไฟล์ต้องมีขนาดไม่เกิน 5 MB')
  const workbook = new ExcelJS.Workbook()
  try { await workbook.xlsx.load(buffer as never) } catch { throw new Error('เปิดไฟล์ .xlsx ไม่สำเร็จ') }
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error('ไม่พบแผ่นงานในไฟล์')
  const header = new Map<string, number>()
  sheet.getRow(1).eachCell((cell, col) => {
    const name = String(cell.value ?? '').trim().toLowerCase()
    if (header.has(name)) throw new Error(`คอลัมน์ ${name} ซ้ำในแถวหัวตาราง`)
    header.set(name, col)
  })
  for (const key of required) if (!header.has(key)) throw new Error(`ไม่พบคอลัมน์บังคับ ${key}`)
  for (const key of header.keys()) if (!columns.includes(key as typeof columns[number])) throw new Error(`คอลัมน์ ${key} ไม่อยู่ในรูปแบบที่รองรับ`)
  if (sheet.rowCount - 1 > 1000) throw new Error('ไฟล์มีข้อมูลเกิน 1,000 แถว')
  const rows: ImportRow[] = []
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber++) {
    const row = sheet.getRow(rowNumber)
    const raw: Record<string, unknown> = {}
    for (const key of columns) {
      const col = header.get(key)
      raw[key] = col ? textCell(row.getCell(col)) : ''
    }
    if (Object.values(raw).every((value) => value === '' || value === null)) continue
    const savedRaw: ImportRaw = {}
    for (const key of columns) {
      const value = raw[key]
      savedRaw[key] = typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value)) ? value : String(value ?? '')
    }
    try {
      const product = validateProduct(raw, categories)
      rows.push({ rowNumber, status: 'valid', reason: '', product, raw: savedRaw })
    } catch (error) {
      rows.push({ rowNumber, status: 'draftReady', reason: error instanceof Error ? error.message : 'ข้อมูลไม่ถูกต้อง', raw: savedRaw })
    }
  }
  if (!rows.length) throw new Error('ไม่พบแถวข้อมูล')
  return rows
}
