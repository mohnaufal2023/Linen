const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET daftar nama ruangan yang pernah tercatat (dari riwayat transaksi)
router.get('/ruangan', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT DISTINCT ruangan FROM serah_terima ORDER BY ruangan ASC`
    );
    res.json(rows.map(r => r.ruangan));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil daftar ruangan' });
  }
});

// GET stok linen di satu ruangan tertentu
// Diantar = laundry mengantar linen ke ruangan (menambah stok)
// Diambil = laundry mengambil linen dari ruangan (infeksius + non-infeksius, mengurangi stok)
// Stok = total diantar - total diambil (infeksius + non-infeksius)
router.get('/:ruangan', async (req, res) => {
  const { ruangan } = req.params;

  try {
    const [rows] = await db.query(
      `SELECT
         l.id AS jenis_linen_id,
         l.nama AS jenis_linen_nama,
         COALESCE(SUM(CASE WHEN st.ruangan = ? THEN d.jumlah_kotor ELSE 0 END), 0) AS total_diantar,
         COALESCE(SUM(CASE WHEN st.ruangan = ? THEN d.jumlah_diambil_infeksius ELSE 0 END), 0) AS total_diambil_infeksius,
         COALESCE(SUM(CASE WHEN st.ruangan = ? THEN d.jumlah_diambil_non_infeksius ELSE 0 END), 0) AS total_diambil_non_infeksius,
         COALESCE(SUM(CASE WHEN st.ruangan = ? THEN d.jumlah_kotor ELSE 0 END), 0)
           - COALESCE(SUM(CASE WHEN st.ruangan = ? THEN d.jumlah_diambil_infeksius + d.jumlah_diambil_non_infeksius ELSE 0 END), 0) AS stok
       FROM jenis_linen l
       LEFT JOIN serah_terima_detail d ON d.jenis_linen_id = l.id
       LEFT JOIN serah_terima st ON st.id = d.serah_terima_id
       GROUP BY l.id, l.nama, l.urutan
       ORDER BY l.urutan ASC`,
      [ruangan, ruangan, ruangan, ruangan, ruangan]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghitung stok ruangan' });
  }
});

module.exports = router;