// src/services/syncHPO.js
// Sync Purchase Order (HPO) dari Accurate → Supabase
// Struktur kolom & tipe data 100% konsisten dengan skema HSO Database

const supabase = require('../utils/supabase')
const { fetchHPOList, fetchHPODetail } = require('../utils/accurate')

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
 * Map data HPO header dari Accurate ke tabel accurate_purchase_orders
 */
function mapHPOHeader(d) {
  return {
    id: safeInt(d.id),
    number: d.number || 'UNKNOWN',
    vendor_id: safeInt(d.vendor?.id),
    vendor_name: d.vendor?.name || d.vendorName || null,
    trans_date: formatDate(d.transDate),
    status_name: d.statusName || d.status || null,
    total_amount: safeFloat(d.totalAmount || d.total),
    currency_code: d.currency?.code || d.currencyCode || 'IDR',
    branch_id: safeInt(d.branch?.id),
    updated_at: new Date().toISOString(),
  }
}

/**
 * Map detail item HPO dari Accurate ke tabel accurate_purchase_order_items
 */
function mapHPOItem(item, headerId, index) {
  return {
    id: safeInt(item.id),
    po_id: safeInt(headerId),
    item_code: item.item?.no || item.itemNo || item.code || null,
    item_name: item.item?.name || item.itemName || null,
    quantity: safeFloat(item.quantity),
    unit_name: item.itemUnit?.name || item.unitName || 'PCS',
    unit_price: safeFloat(item.unitPrice),
    item_disc_percent: safeFloat(item.itemDiscPercent),
    detail_notes: item.detailNotes || item.notes || null,
    item_seq: safeInt(item.itemSeq ?? index),
    hso_number: extractHso(item.detailNotes || item.notes || '') || item.hsoNumber || null,
  }
}

/**
 * Upsert satu HPO (header + items) ke Supabase
 */
async function upsertHPO(accurateData) {
  const d = accurateData.d || accurateData
  if (!d?.id) return { success: false, error: 'No ID in data' }

  const header = mapHPOHeader(d)

  // 1. Upsert header
  const { error: headerErr } = await supabase
    .from('accurate_purchase_orders')
    .upsert(header, { onConflict: 'id' })

  if (headerErr) {
    console.error(`❌ [HPO] Header upsert error (${header.number}):`, headerErr.message)
    return { success: false, error: headerErr.message }
  }

  // 2. Clean and Insert items jika ada detailItem
  if (Array.isArray(d.detailItem)) {
    // Hapus item lama untuk PO ini agar tidak ada duplikasi atau item orphan
    await supabase
      .from('accurate_purchase_order_items')
      .delete()
      .eq('po_id', header.id)

    if (d.detailItem.length > 0) {
      const items = d.detailItem.map((item, idx) => mapHPOItem(item, header.id, idx))
      const { error: itemsErr } = await supabase
        .from('accurate_purchase_order_items')
        .insert(items)

      if (itemsErr) {
        console.error(`❌ [HPO] Items insert error (${header.number}):`, itemsErr.message)
      }
    }
  }

  console.log(`✅ [HPO] ${header.number} (ID: ${header.id}) synced`)
  return { success: true, number: header.number, id: header.id }
}

/**
 * Sync semua HPO dari Accurate → Supabase
 * @param {number} daysBack - Berapa hari ke belakang (default: 30)
 * @param {string} fromDate - Opsional, tanggal spesifik (YYYY-MM-DD)
 */
async function fullSyncHPO(daysBack = 30, fromDate = null) {
  const fromDateStr = fromDate || (() => {
    const d = new Date()
    d.setDate(d.getDate() - daysBack)
    return d.toISOString().split('T')[0]
  })()

  const label = fromDate ? `delta (sejak ${fromDateStr})` : `${daysBack} hari terakhir`
  console.log(`\n🔄 Sync HPO — ${label}`)

  let page = 1
  let totalSynced = 0
  let hasMore = true
  const errors = []
  const pageSize = parseInt(process.env.SYNC_PAGE_SIZE, 10) || 50

  while (hasMore) {
    try {
      const listData = await fetchHPOList({
        page,
        pageSize,
        fromDate: fromDateStr,
      })

      const items = listData?.d || listData?.data || []
      if (!items.length) {
        hasMore = false
        break
      }

      for (const hpo of items) {
        const itemDate = formatDate(hpo.transDate)
        if (itemDate && itemDate < fromDateStr) {
          hasMore = false
          break
        }

        try {
          const detail = await fetchHPODetail(hpo.id)
          await upsertHPO(detail)
          totalSynced++
        } catch (err) {
          console.warn(`⚠️ Gagal sync HPO ${hpo.number}:`, err.message)
          errors.push(`HPO ${hpo.number}: ${err.message}`)
        }
      }

      const totalPages = listData?.pageCount || listData?.totalPage || 1
      if (hasMore) {
        hasMore = page < totalPages && items.length === pageSize
        page++
      }
    } catch (err) {
      console.error(`❌ Error saat fetch HPO list halaman ${page}:`, err.message)
      errors.push(`Page ${page}: ${err.message}`)
      hasMore = false
    }
  }

  console.log(`✅ HPO sync selesai: ${totalSynced} dokumen diproses`)
  return { processed: totalSynced, updated: totalSynced, errors }
}

module.exports = {
  upsertHPO,
  fullSyncHPO,
  mapHPOHeader,
  mapHPOItem,
}
