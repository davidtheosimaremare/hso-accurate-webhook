// src/services/syncHDO.js
// Sync Delivery Order (HDO/Surat Jalan) dari Accurate → Supabase
// Struktur kolom & tipe data 100% konsisten dengan skema HSO Database

const supabase = require('../utils/supabase')
const { fetchHDOList, fetchHDODetail } = require('../utils/accurate')

function formatDate(dateStr) {
  if (!dateStr) return null
  const parts = String(dateStr).split('/')
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`
  if (String(dateStr).match(/^\d{4}-\d{2}-\d{2}$/)) return String(dateStr)
  return null
}

function safeFloat(val) {
  if (typeof val === 'number') return val
  if (typeof val === 'string') return parseFloat(val.replace(/,/g, '')) || 0
  return 0
}

function safeInt(val) {
  if (typeof val === 'number') return Math.floor(val)
  if (typeof val === 'string') return parseInt(val, 10) || null
  return null
}

function extractHso(note) {
  if (!note) return null
  const match = String(note).match(/(HSO\/[\w\d\/]+)/i)
  return match ? match[1] : null
}

/**
 * Map data HDO header dari Accurate ke tabel accurate_delivery_orders
 */
function mapHDOHeader(d) {
  return {
    id: safeInt(d.id),
    number: d.number || 'UNKNOWN',
    customer_id: safeInt(d.customer?.id),
    customer_name: d.customer?.name || d.customerName || null,
    trans_date: formatDate(d.transDate),
    status_name: d.statusName || d.status || null,
    ship_to: d.shipTo || d.address || null,
    driver_name: d.driverName || d.driver || d.shippedVia || null,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Map detail item HDO dari Accurate ke tabel accurate_delivery_order_items
 */
function mapHDOItem(item, headerId, index) {
  return {
    id: safeInt(item.id),
    do_id: safeInt(headerId),
    item_code: item.item?.no || item.itemNo || item.code || null,
    item_name: item.item?.name || item.itemName || null,
    quantity: safeFloat(item.quantity),
    unit_name: item.itemUnit?.name || item.unitName || 'PCS',
    detail_notes: item.detailNotes || item.notes || null,
    item_seq: safeInt(item.itemSeq ?? index),
    hso_number: extractHso(item.detailNotes || item.notes || '') || item.hsoNumber || null,
  }
}

/**
 * Upsert satu HDO ke Supabase
 */
async function upsertHDO(accurateData) {
  const d = accurateData.d || accurateData
  if (!d?.id) return { success: false, error: 'No ID in data' }

  const header = mapHDOHeader(d)

  // 1. Upsert header
  const { error: headerErr } = await supabase
    .from('accurate_delivery_orders')
    .upsert(header, { onConflict: 'id' })

  if (headerErr) {
    console.error(`❌ [HDO] Header upsert error (${header.number}):`, headerErr.message)
    return { success: false, error: headerErr.message }
  }

  // 2. Clean and Insert items jika ada detailItem
  if (Array.isArray(d.detailItem)) {
    // Hapus item lama untuk HDO ini
    await supabase
      .from('accurate_delivery_order_items')
      .delete()
      .eq('do_id', header.id)

    if (d.detailItem.length > 0) {
      const items = d.detailItem.map((item, idx) => mapHDOItem(item, header.id, idx))
      const { error: itemsErr } = await supabase
        .from('accurate_delivery_order_items')
        .insert(items)

      if (itemsErr) {
        console.error(`❌ [HDO] Items insert error (${header.number}):`, itemsErr.message)
      }
    }
  }

  console.log(`✅ [HDO] ${header.number} (ID: ${header.id}) synced`)
  return { success: true, number: header.number, id: header.id }
}

/**
 * Sync semua HDO dari Accurate → Supabase
 * @param {number} daysBack - Berapa hari ke belakang (default: 30)
 * @param {string} fromDate - Opsional, tanggal spesifik (YYYY-MM-DD)
 */
async function fullSyncHDO(daysBack = 30, fromDate = null) {
  const fromDateStr = fromDate || (() => {
    const d = new Date()
    d.setDate(d.getDate() - daysBack)
    return d.toISOString().split('T')[0]
  })()

  const label = fromDate ? `delta (sejak ${fromDateStr})` : `${daysBack} hari terakhir`
  console.log(`\n🔄 Sync HDO — ${label}`)

  let page = 1
  let totalSynced = 0
  let hasMore = true
  const errors = []
  const pageSize = parseInt(process.env.SYNC_PAGE_SIZE, 10) || 50

  while (hasMore) {
    try {
      const listData = await fetchHDOList({
        page,
        pageSize,
        fromDate: fromDateStr,
      })

      const items = listData?.d || listData?.data || []
      if (!items.length) {
        hasMore = false
        break
      }

      for (const hdo of items) {
        const itemDate = formatDate(hdo.transDate)
        if (itemDate && itemDate < fromDateStr) {
          hasMore = false
          break
        }

        try {
          const detail = await fetchHDODetail(hdo.id)
          await upsertHDO(detail)
          totalSynced++
        } catch (err) {
          console.warn(`⚠️ Gagal sync HDO ${hdo.number}:`, err.message)
          errors.push(`HDO ${hdo.number}: ${err.message}`)
        }
      }

      const totalPages = listData?.pageCount || listData?.totalPage || 1
      if (hasMore) {
        hasMore = page < totalPages && items.length === pageSize
        page++
      }
    } catch (err) {
      console.error(`❌ Error saat fetch HDO list halaman ${page}:`, err.message)
      errors.push(`Page ${page}: ${err.message}`)
      hasMore = false
    }
  }

  console.log(`✅ HDO sync selesai: ${totalSynced} dokumen diproses`)
  return { processed: totalSynced, updated: totalSynced, errors }
}

module.exports = {
  upsertHDO,
  fullSyncHDO,
  mapHDOHeader,
  mapHDOItem,
}
