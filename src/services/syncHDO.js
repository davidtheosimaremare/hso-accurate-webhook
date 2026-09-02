// src/services/syncHDO.js
// Sync Delivery Order (HDO/Surat Jalan) dari Accurate → Supabase

const supabase = require('../utils/supabase')
const { fetchHDOList, fetchHDODetail } = require('../utils/accurate')

function extractHso(note) {
  if (!note) return null
  const match = note.match(/(HSO\/[\w\d\/]+)/i)
  return match ? match[1] : null
}

function mapHDOHeader(d) {
  return {
    id: d.id,
    number: d.number,
    trans_date: d.transDate || null,
    status_name: d.statusName || d.status || null,
    customer_id: d.customer?.id || null,
    customer_name: d.customer?.name || d.customerName || null,
    so_number: d.salesOrder?.number || d.soNumber || null,
    description: d.description || d.notes || null,
    warehouse_name: d.warehouse?.name || null,
    branch_name: d.branch?.name || null,
    shipped_via: d.shippedVia || d.expedisi || null,
    synced_at: new Date().toISOString(),
  }
}

function mapHDOItem(item, headerId) {
  return {
    id: item.id,
    delivery_order_id: headerId,
    item_no: item.item?.no || item.itemNo || null,
    item_name: item.item?.name || item.itemName || null,
    quantity: parseFloat(item.quantity) || 0,
    unit_name: item.itemUnit?.name || item.unitName || 'PCS',
    detail_notes: item.detailNotes || item.notes || null,
    hso_number: extractHso(item.detailNotes || '') || item.hsoNumber || null,
    item_seq: item.itemSeq || 0,
    synced_at: new Date().toISOString(),
  }
}

/**
 * Upsert satu HDO ke Supabase
 */
async function upsertHDO(accurateData) {
  const d = accurateData.d || accurateData
  if (!d?.id) return { success: false, error: 'No ID in data' }

  const header = mapHDOHeader(d)

  const { error: headerErr } = await supabase
    .from('accurate_delivery_orders')
    .upsert(header, { onConflict: 'id' })

  if (headerErr) {
    console.error('❌ HDO header upsert error:', headerErr.message)
    return { success: false, error: headerErr.message }
  }

  if (Array.isArray(d.detailItem) && d.detailItem.length > 0) {
    const items = d.detailItem.map(item => mapHDOItem(item, d.id))
    const { error: itemsErr } = await supabase
      .from('accurate_delivery_order_items')
      .upsert(items, { onConflict: 'id' })

    if (itemsErr) {
      console.error('❌ HDO items upsert error:', itemsErr.message)
    }
  }

  console.log(`✅ HDO ${d.number} (id:${d.id}) synced`)
  return { success: true, number: d.number }
}

/**
 * Full sync semua HDO dalam N hari terakhir
 */
async function fullSyncHDO(daysBack = 30) {
  console.log(`\n🔄 Full sync HDO — ${daysBack} hari terakhir`)
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - daysBack)
  const fromDateStr = fromDate.toISOString().split('T')[0]

  let page = 1
  let totalSynced = 0
  let hasMore = true

  while (hasMore) {
    try {
      const listData = await fetchHDOList({
        page,
        pageSize: parseInt(process.env.SYNC_PAGE_SIZE) || 50,
        fromDate: fromDateStr
      })

      const items = listData?.d || listData?.data || []
      if (!items.length) { hasMore = false; break }

      for (const hdo of items) {
        try {
          const detail = await fetchHDODetail(hdo.id)
          await upsertHDO(detail)
          totalSynced++
        } catch (err) {
          console.warn(`⚠️ Gagal sync HDO ${hdo.number}:`, err.message)
        }
      }

      const totalPages = listData?.pageCount || listData?.totalPage || 1
      hasMore = page < totalPages
      page++
    } catch (err) {
      console.error('❌ Error saat fetch HDO list halaman', page, ':', err.message)
      hasMore = false
    }
  }

  console.log(`✅ HDO sync selesai: ${totalSynced} dokumen`)
  return totalSynced
}

module.exports = { upsertHDO, fullSyncHDO }
