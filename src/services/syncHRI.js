// src/services/syncHRI.js
// Sync Receive Item (HRI/Penerimaan Barang) dari Accurate → Supabase
// HRI yang masuk ke Hokiindo → otomatis update hokiindo_date di tabel shipments

const supabase = require('../utils/supabase')
const { fetchHRIList, fetchHRIDetail } = require('../utils/accurate')

function extractHso(note) {
  if (!note) return null
  const match = note.match(/(HSO\/[\w\d\/]+)/i)
  return match ? match[1] : null
}

/**
 * Map data HRI header dari Accurate ke struktur Supabase
 */
function mapHRIHeader(d) {
  return {
    id: d.id,
    number: d.number,
    trans_date: d.transDate || null,
    status_name: d.statusName || d.status || null,
    vendor_id: d.vendor?.id || null,
    vendor_name: d.vendor?.name || d.vendorName || null,
    po_number: d.purchaseOrder?.number || d.poNumber || null,
    description: d.description || d.notes || null,
    warehouse_name: d.warehouse?.name || null,
    branch_name: d.branch?.name || null,
    received_by: d.receivedBy || d.charField1 || null,
    synced_at: new Date().toISOString(),
  }
}

function mapHRIItem(item, headerId) {
  return {
    id: item.id,
    receive_item_id: headerId,
    item_code: item.item?.no || item.itemNo || item.code || null,
    item_name: item.item?.name || item.itemName || null,
    quantity: parseFloat(item.quantity) || 0,
    unit_name: item.itemUnit?.name || item.unitName || 'PCS',
    detail_notes: item.detailNotes || item.notes || null,
    hso_number: extractHso(item.detailNotes || '') || item.hsoNumber || null,
    po_number: item.purchaseOrder?.number || item.poNumber || null,
    warehouse_name: item.warehouse?.name || null,
    item_seq: item.itemSeq || 0,
    synced_at: new Date().toISOString(),
  }
}

/**
 * Setelah HRI masuk, update shipments.hokiindo_date
 * berdasarkan item_code + hpo_number yang ada di HRI items
 */
async function updateShipmentsFromHRI(hriItems, transDate) {
  const hokiindoDate = transDate?.split('T')[0] || new Date().toISOString().split('T')[0]
  let updated = 0

  for (const item of hriItems) {
    const itemCode = item.item_code
    const poNumber = item.po_number
    if (!itemCode) continue

    // Cari shipment yang cocok berdasarkan item_code + hpo_number
    let query = supabase
      .from('shipments')
      .select('id, hpo_number, item_code, hokiindo_date, current_status')
      .eq('item_code', itemCode)

    if (poNumber) {
      query = query.ilike('hpo_number', `%${poNumber}%`)
    }

    const { data: shipments, error } = await query

    if (error) {
      console.warn(`⚠️ Gagal cari shipment untuk ${itemCode}:`, error.message)
      continue
    }

    if (!shipments?.length) continue

    for (const ship of shipments) {
      // Hanya update jika hokiindo_date belum ada
      if (ship.hokiindo_date) continue

      const { error: updateErr } = await supabase
        .from('shipments')
        .update({
          hokiindo_date: hokiindoDate,
          current_status: 'Already in Hokiindo Raya',
          status_date: hokiindoDate,
          updated_at: new Date().toISOString(),
        })
        .eq('id', ship.id)

      if (!updateErr) {
        console.log(`  📦 Shipment ${ship.hpo_number}/${itemCode} → hokiindo_date: ${hokiindoDate}`)
        updated++
      }
    }
  }

  return updated
}

/**
 * Upsert satu HRI ke Supabase dan update shipments
 */
async function upsertHRI(accurateData) {
  const d = accurateData.d || accurateData
  if (!d?.id) return { success: false, error: 'No ID in data' }

  const header = mapHRIHeader(d)

  // Upsert header
  const { error: headerErr } = await supabase
    .from('accurate_receive_items')
    .upsert(header, { onConflict: 'id' })

  if (headerErr) {
    console.error('❌ HRI header upsert error:', headerErr.message)
    return { success: false, error: headerErr.message }
  }

  // Upsert items
  let mappedItems = []
  if (Array.isArray(d.detailItem) && d.detailItem.length > 0) {
    mappedItems = d.detailItem.map(item => mapHRIItem(item, d.id))
    const { error: itemsErr } = await supabase
      .from('accurate_receive_item_items')
      .upsert(mappedItems, { onConflict: 'id' })

    if (itemsErr) {
      console.error('❌ HRI items upsert error:', itemsErr.message)
    }
  }

  // 🔑 Update shipments.hokiindo_date berdasarkan item yang diterima
  if (mappedItems.length > 0) {
    const shipmentsUpdated = await updateShipmentsFromHRI(mappedItems, d.transDate)
    console.log(`  ✅ HRI ${d.number} → ${shipmentsUpdated} shipments di-update hokiindo_date`)
  }

  console.log(`✅ HRI ${d.number} (id:${d.id}) synced`)
  return { success: true, number: d.number }
}

/**
 * Full sync semua HRI dalam N hari terakhir
 */
async function fullSyncHRI(daysBack = 30) {
  console.log(`\n🔄 Full sync HRI — ${daysBack} hari terakhir`)
  const fromDate = new Date()
  fromDate.setDate(fromDate.getDate() - daysBack)
  const fromDateStr = fromDate.toISOString().split('T')[0]

  let page = 1
  let totalSynced = 0
  let hasMore = true

  while (hasMore) {
    try {
      const listData = await fetchHRIList({
        page,
        pageSize: parseInt(process.env.SYNC_PAGE_SIZE) || 50,
        fromDate: fromDateStr
      })

      const items = listData?.d || listData?.data || []
      if (!items.length) { hasMore = false; break }

      for (const hri of items) {
        try {
          const detail = await fetchHRIDetail(hri.id)
          await upsertHRI(detail)
          totalSynced++
        } catch (err) {
          console.warn(`⚠️ Gagal sync HRI ${hri.number}:`, err.message)
        }
      }

      const totalPages = listData?.pageCount || listData?.totalPage || 1
      hasMore = page < totalPages
      page++
    } catch (err) {
      console.error('❌ Error saat fetch HRI list halaman', page, ':', err.message)
      hasMore = false
    }
  }

  console.log(`✅ HRI sync selesai: ${totalSynced} dokumen`)
  return totalSynced
}

module.exports = { upsertHRI, fullSyncHRI }
