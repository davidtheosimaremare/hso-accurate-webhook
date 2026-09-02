// src/services/syncHPO.js
// Sync Purchase Order (HPO) dari Accurate → Supabase

const supabase = require('../utils/supabase')
const { fetchHPOList, fetchHPODetail } = require('../utils/accurate')

/**
 * Map data HPO dari Accurate ke struktur tabel Supabase
 */
function mapHPOHeader(d) {
  return {
    id: d.id,
    number: d.number,
    trans_date: d.transDate || null,
    status_name: d.statusName || d.status || null,
    vendor_id: d.vendor?.id || null,
    vendor_name: d.vendor?.name || d.vendorName || null,
    description: d.description || d.notes || null,
    warehouse_name: d.warehouse?.name || null,
    branch_name: d.branch?.name || null,
    total_amount: d.totalAmount || d.total || null,
    currency_code: d.currency?.code || 'IDR',
    synced_at: new Date().toISOString(),
  }
}

function mapHPOItem(item, headerId) {
  return {
    id: item.id,
    purchase_order_id: headerId,
    item_no: item.item?.no || item.itemNo || null,
    item_name: item.item?.name || item.itemName || null,
    quantity: parseFloat(item.quantity) || 0,
    unit_name: item.itemUnit?.name || item.unitName || 'PCS',
    unit_price: parseFloat(item.unitPrice) || 0,
    total_amount: parseFloat(item.totalAmount) || 0,
    detail_notes: item.detailNotes || item.notes || null,
    hso_number: extractHso(item.detailNotes || '') || item.hsoNumber || null,
    item_seq: item.itemSeq || 0,
    synced_at: new Date().toISOString(),
  }
}

function extractHso(note) {
  if (!note) return null
  const match = note.match(/(HSO\/[\w\d\/]+)/i)
  return match ? match[1] : null
}

/**
 * Upsert satu HPO (header + items) ke Supabase
 */
async function upsertHPO(accurateData) {
  const d = accurateData.d || accurateData
  if (!d?.id) return { success: false, error: 'No ID in data' }

  const header = mapHPOHeader(d)

  // Upsert header
  const { error: headerErr } = await supabase
    .from('accurate_purchase_orders')
    .upsert(header, { onConflict: 'id' })

  if (headerErr) {
    console.error('❌ HPO header upsert error:', headerErr.message)
    return { success: false, error: headerErr.message }
  }

  // Upsert items jika ada
  if (Array.isArray(d.detailItem) && d.detailItem.length > 0) {
    const items = d.detailItem.map(item => mapHPOItem(item, d.id))
    const { error: itemsErr } = await supabase
      .from('accurate_purchase_order_items')
      .upsert(items, { onConflict: 'id' })

    if (itemsErr) {
      console.error('❌ HPO items upsert error:', itemsErr.message)
    }
  }

  console.log(`✅ HPO ${d.number} (id:${d.id}) synced`)
  return { success: true, number: d.number }
}

/**
 * Full sync semua HPO dalam N hari terakhir
 */
async function fullSyncHPO(daysBack = 30) {
  console.log(`\n🔄 Full sync HPO — ${daysBack} hari terakhir`)
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - daysBack)
  const fromDateStr = fromDate.toISOString().split('T')[0] // YYYY-MM-DD

  let page = 1
  let totalSynced = 0
  let hasMore = true

  while (hasMore) {
    try {
      const listData = await fetchHPOList({
        page,
        pageSize: parseInt(process.env.SYNC_PAGE_SIZE) || 50,
        fromDate: fromDateStr
      })

      const items = listData?.d || listData?.data || []
      if (!items.length) { hasMore = false; break }

      for (const hpo of items) {
        // Ambil detail untuk tiap HPO (agar dapat detailItem)
        try {
          const detail = await fetchHPODetail(hpo.id)
          await upsertHPO(detail)
          totalSynced++
        } catch (err) {
          console.warn(`⚠️ Gagal sync HPO ${hpo.number}:`, err.message)
        }
      }

      // Cek apakah masih ada halaman berikutnya
      const totalPages = listData?.pageCount || listData?.totalPage || 1
      hasMore = page < totalPages
      page++
    } catch (err) {
      console.error('❌ Error saat fetch HPO list halaman', page, ':', err.message)
      hasMore = false
    }
  }

  console.log(`✅ HPO sync selesai: ${totalSynced} dokumen`)
  return totalSynced
}

module.exports = { upsertHPO, fullSyncHPO }
