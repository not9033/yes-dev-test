import { createHash } from 'node:crypto'

export const defaultCategories = ['Cleanser', 'Toner', 'Serum', 'Moisturizer', 'Sunscreen', 'Mask']
export const maxImageBytes = 2 * 1024 * 1024
export function validImageSignature(bytes: Buffer, type: string): boolean {
  if (type === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (type === 'image/png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (type === 'image/webp') return bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
  return false
}
export type ProductStatus = 'active' | 'inactive'
export type ProductInput = {
  sku: string
  name: string
  category: string
  priceSatang: number
  size: string
  description: string
  how_to_use: string
  status: ProductStatus
}
export type ImportRaw = Record<string, string | number>
export type DraftProduct = ProductInput & { importIssues: string[]; importRaw: ImportRaw }

export function mergeImportRow(raw: ImportRaw, existing?: Record<string, unknown>): ImportRaw {
  if (!existing) return raw
  const merged: ImportRaw = {}
  for (const key of ['sku', 'name', 'category', 'price', 'size', 'description', 'how_to_use', 'status']) {
    const value = raw[key]
    if (typeof value === 'number' || (typeof value === 'string' && value.trim())) {
      merged[key] = value
    } else if (key === 'price') {
      merged[key] = typeof existing.priceSatang === 'number' ? existing.priceSatang / 100 : 0
    } else {
      const previous = existing[key]
      merged[key] = typeof previous === 'string' ? previous : ''
    }
  }
  return merged
}

export function categoryKey(name: string): string {
  return createHash('sha256').update(name.trim().toLocaleLowerCase('en-US')).digest('hex')
}

export function skuKey(sku: string): string {
  return sku.trim().toUpperCase()
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label}: ต้องเป็นข้อความและห้ามว่าง`)
  return value.trim()
}

function optionalText(value: unknown, label: string): string {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value !== 'string') throw new Error(`${label}: ต้องเป็นข้อความ`)
  return value.trim()
}

export function parsePrice(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('price: ต้องเป็นตัวเลขบาทที่มากกว่า 0')
  }
  const satang = Math.round(value * 100)
  if (!Number.isSafeInteger(satang) || Math.abs(value * 100 - satang) > 0.000001) {
    throw new Error('price: ระบุทศนิยมได้ไม่เกิน 2 ตำแหน่ง')
  }
  return satang
}

export function validateProduct(raw: Record<string, unknown>, categories: string[]): ProductInput {
  const sku = requiredText(raw.sku, 'sku').toUpperCase()
  if (!/^LS-[0-9]{4}$/.test(sku)) throw new Error('sku: ต้องอยู่ในรูปแบบ LS-0000')
  const name = requiredText(raw.name, 'name')
  const category = optionalText(raw.category, 'category')
  const matchedCategory = category ? categories.find((item) => item.toLocaleLowerCase('en-US') === category.toLocaleLowerCase('en-US')) : ''
  if (category && !matchedCategory) throw new Error(`category: ไม่มีหมวดหมู่ “${category}” ในระบบ`)
  const statusRaw = optionalText(raw.status, 'status').toLowerCase()
  if (statusRaw && statusRaw !== 'active' && statusRaw !== 'inactive') throw new Error('status: ต้องเป็น active หรือ inactive')
  return {
    sku, name, category: matchedCategory || '', priceSatang: parsePrice(raw.price),
    size: optionalText(raw.size, 'size'), description: optionalText(raw.description, 'description'),
    how_to_use: optionalText(raw.how_to_use, 'how_to_use'), status: (statusRaw || 'active') as ProductStatus,
  }
}

export function draftProduct(raw: ImportRaw, categories: string[], reason: string): DraftProduct {
  const originalSku = typeof raw.sku === 'string' ? raw.sku.trim().toUpperCase() : ''
  const sku = /^LS-[0-9]{4}$/.test(originalSku) ? originalSku : ''
  const text = (value: string | number | undefined) => typeof value === 'string' ? value.trim() : ''
  const categoryText = text(raw.category)
  const category = categories.find((item) => item.toLocaleLowerCase('en-US') === categoryText.toLocaleLowerCase('en-US')) || ''
  let priceSatang = 0
  try { priceSatang = parsePrice(raw.price) } catch { /* Keep the draft price empty until an Admin fixes it. */ }
  const importIssues = reason.split('; ').filter(Boolean)
  return {
    sku, name: text(raw.name), category, priceSatang,
    size: text(raw.size), description: text(raw.description), how_to_use: text(raw.how_to_use),
    status: 'inactive', importIssues, importRaw: raw,
  }
}

export function bangkokDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value || ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
