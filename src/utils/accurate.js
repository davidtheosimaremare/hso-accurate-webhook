// src/utils/accurate.js
// Accurate Online API client

const axios = require('axios')

const accurateClient = axios.create({
  baseURL: process.env.ACCURATE_BASE_URL || 'https://account.accurate.id',
  headers: {
    'X-SESSION-ID': process.env.ACCURATE_SESSION,
    'X-Api-Database-Id': process.env.ACCURATE_DB_ID,
    'Content-Type': 'application/json',
  },
  timeout: 30000,
})

// Retry dengan exponential backoff jika rate limit (429) atau server error
accurateClient.interceptors.response.use(
  (res) => res,
  async (err) => {
    const config = err.config
    if (!config || config._retryCount >= 3) return Promise.reject(err)
    const status = err.response?.status
    if (status === 429 || status >= 500) {
      config._retryCount = (config._retryCount || 0) + 1
      const delay = config._retryCount * 2000
      console.log(`⏳ Accurate API retry ${config._retryCount} setelah ${delay}ms (status ${status})`)
      await new Promise(r => setTimeout(r, delay))
      return accurateClient(config)
    }
    return Promise.reject(err)
  }
)

/**
 * Ambil list HPO (Purchase Order) dari Accurate
 */
async function fetchHPOList({ page = 1, pageSize = 50, fromDate = null } = {}) {
  const params = {
    page,
    pageSize,
    'filter.draftStatus': 'POSTED',
    'sp.sort': 'transDate',
    'sp.dir': 'DESC',
  }
  if (fromDate) params['filter.transDateFrom'] = fromDate

  const res = await accurateClient.get('/accurate/api/purchase-order/list.do', { params })
  return res.data
}

/**
 * Ambil detail HPO berdasarkan ID
 */
async function fetchHPODetail(id) {
  const res = await accurateClient.get('/accurate/api/purchase-order/detail.do', {
    params: { id }
  })
  return res.data
}

/**
 * Ambil list HRI (Receive Item / Penerimaan Barang) dari Accurate
 */
async function fetchHRIList({ page = 1, pageSize = 50, fromDate = null } = {}) {
  const params = {
    page,
    pageSize,
    'sp.sort': 'transDate',
    'sp.dir': 'DESC',
  }
  if (fromDate) params['filter.transDateFrom'] = fromDate

  const res = await accurateClient.get('/accurate/api/receive-item/list.do', { params })
  return res.data
}

/**
 * Ambil detail HRI berdasarkan ID
 */
async function fetchHRIDetail(id) {
  const res = await accurateClient.get('/accurate/api/receive-item/detail.do', {
    params: { id }
  })
  return res.data
}

/**
 * Ambil list HDO (Delivery Order / Surat Jalan) dari Accurate
 */
async function fetchHDOList({ page = 1, pageSize = 50, fromDate = null } = {}) {
  const params = {
    page,
    pageSize,
    'sp.sort': 'transDate',
    'sp.dir': 'DESC',
  }
  if (fromDate) params['filter.transDateFrom'] = fromDate

  const res = await accurateClient.get('/accurate/api/delivery-order/list.do', { params })
  return res.data
}

/**
 * Ambil detail HDO berdasarkan ID
 */
async function fetchHDODetail(id) {
  const res = await accurateClient.get('/accurate/api/delivery-order/detail.do', {
    params: { id }
  })
  return res.data
}

module.exports = {
  fetchHPOList,
  fetchHPODetail,
  fetchHRIList,
  fetchHRIDetail,
  fetchHDOList,
  fetchHDODetail,
}
