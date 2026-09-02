const express = require('express');
const router = express.Router();
const db = require('../config/db');

// POST simpan transaksi serah terima baru
// Body yang diharapkan:
// {
//   "ruangan": "ICU",
//   "tanggal": "2026-09-02",
//   "detail": [
//     { "jenis_linen_id": 1, "jumlah_kotor": 5, "jumlah_bersih": 3, "keterangan": "" },
//     { "jenis_linen_id": 2, "jumlah_kotor": 0, "jumlah_bersih": 2, "keterangan": "" }
//   ]
// }
router.post('/', async (req, res) => {
  const { ruangan, tanggal, detail } = req.body;

  // Validasi dasar
  if (!ruangan || !tanggal) {
    return res.status(400).json({ error: 'Ruangan dan tanggal wajib diisi' });
  }
  if (!Array.isArray(detail) || detail.length === 0) {
    return res.status(400).json({ error: 'Detail linen tidak boleh kosong' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Simpan header ke tabel serah_terima
    const [headerResult] = await connection.query(
      'INSERT INTO serah_terima (ruangan, tanggal) VALUES (?, ?)',
      [ruangan, tanggal]
    );
    const serahTerimaId = headerResult.insertId;

    // 2. Simpan tiap baris detail ke tabel serah_terima_detail
    for (const item of detail) {
      const jumlahKotor = item.jumlah_kotor || 0;
      const jumlahBersih = item.jumlah_bersih || 0;

      // Lewati baris yang benar-benar kosong (kotor dan bersih sama-sama 0)
      if (jumlahKotor === 0 && jumlahBersih === 0) continue;

      await connection.query(
        `INSERT INTO serah_terima_detail
         (serah_terima_id, jenis_linen_id, jumlah_kotor, jumlah_bersih, keterangan)
         VALUES (?, ?, ?, ?, ?)`,
        [serahTerimaId, item.jenis_linen_id, jumlahKotor, jumlahBersih, item.keterangan || null]
      );
    }

    await connection.commit();
    res.status(201).json({ message: 'Data serah terima berhasil disimpan', id: serahTerimaId });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ error: 'Gagal menyimpan data serah terima' });
  } finally {
    connection.release();
  }
});

module.exports = router;