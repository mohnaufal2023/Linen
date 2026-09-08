const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET daftar semua transaksi serah terima, terbaru duluan
// Sekalian dihitung total diantar, infeksius, dan non-infeksius per transaksi
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT
         st.id, st.ruangan, st.tanggal, st.created_at,
         COALESCE(SUM(d.jumlah_kotor), 0) AS total_kotor,
         COALESCE(SUM(d.jumlah_diambil_infeksius), 0) AS total_infeksius,
         COALESCE(SUM(d.jumlah_diambil_non_infeksius), 0) AS total_non_infeksius,
         COALESCE(SUM(d.jumlah_diambil_infeksius + d.jumlah_diambil_non_infeksius), 0) AS total_bersih
       FROM serah_terima st
       LEFT JOIN serah_terima_detail d ON d.serah_terima_id = st.id
       GROUP BY st.id, st.ruangan, st.tanggal, st.created_at
       ORDER BY st.created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data riwayat' });
  }
});

// GET detail satu transaksi (header + semua baris linennya)
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [headerRows] = await db.query(
      'SELECT id, ruangan, tanggal, created_at, nama_penerima, tanda_tangan FROM serah_terima WHERE id = ?',
      [id]
    );

    if (headerRows.length === 0) {
      return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    }

    const [detailRows] = await db.query(
      `SELECT d.id, d.jenis_linen_id, l.nama AS jenis_linen_nama,
              d.jumlah_kotor,
              d.jumlah_diambil_infeksius, d.jumlah_diambil_non_infeksius,
              d.verifikasi_infeksius,
              d.keterangan
       FROM serah_terima_detail d
       JOIN jenis_linen l ON l.id = d.jenis_linen_id
       WHERE d.serah_terima_id = ?
       ORDER BY l.urutan ASC`,
      [id]
    );

    res.json({
      ...headerRows[0],
      detail: detailRows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil detail transaksi' });
  }
});

// PUT ubah status verifikasi infeksius untuk satu baris detail linen
// Body: { verifikasi_infeksius: 0 atau 1 }
router.put('/detail/:detailId/verifikasi', async (req, res) => {
  const { detailId } = req.params;
  const { verifikasi_infeksius } = req.body;

  try {
    const [result] = await db.query(
      'UPDATE serah_terima_detail SET verifikasi_infeksius = ? WHERE id = ?',
      [verifikasi_infeksius ? 1 : 0, detailId]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Baris detail tidak ditemukan' });
    }

    res.json({ message: 'Status verifikasi berhasil diperbarui' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui status verifikasi' });
  }
});

// PUT update satu transaksi (ganti header + seluruh detail linennya)
// Body: { ruangan, tanggal, detail: [{ jenis_linen_id, jumlah_kotor, jumlah_diambil_infeksius, jumlah_diambil_non_infeksius, keterangan }] }
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { ruangan, tanggal, detail, nama_penerima, tanda_tangan } = req.body;

  if (!ruangan || !tanggal) {
    return res.status(400).json({ error: 'Ruangan dan tanggal wajib diisi' });
  }
  if (!Array.isArray(detail) || detail.length === 0) {
    return res.status(400).json({ error: 'Detail linen tidak boleh kosong' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [updateResult] = await connection.query(
      'UPDATE serah_terima SET ruangan = ?, tanggal = ?, nama_penerima = ?, tanda_tangan = ? WHERE id = ?',
      [ruangan, tanggal, nama_penerima || null, tanda_tangan || null, id]
    );

    if (updateResult.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    }

    await connection.query(
      'DELETE FROM serah_terima_detail WHERE serah_terima_id = ?',
      [id]
    );

    for (const item of detail) {
      const jumlahKotor = item.jumlah_kotor || 0;
      const jumlahInfeksius = item.jumlah_diambil_infeksius || 0;
      const jumlahNonInfeksius = item.jumlah_diambil_non_infeksius || 0;
      const verifikasi = item.verifikasi_infeksius ? 1 : 0;

      if (jumlahKotor === 0 && jumlahInfeksius === 0 && jumlahNonInfeksius === 0) continue;

      await connection.query(
        `INSERT INTO serah_terima_detail
         (serah_terima_id, jenis_linen_id, jumlah_kotor, jumlah_diambil_infeksius, jumlah_diambil_non_infeksius, verifikasi_infeksius, keterangan)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [id, item.jenis_linen_id, jumlahKotor, jumlahInfeksius, jumlahNonInfeksius, verifikasi, item.keterangan || null]
      );
    }

    await connection.commit();
    res.json({ message: 'Transaksi berhasil diperbarui' });
  } catch (err) {
    await connection.rollback();
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui transaksi' });
  } finally {
    connection.release();
  }
});

// DELETE hapus satu transaksi (detail ikut terhapus otomatis karena ON DELETE CASCADE)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [result] = await db.query(
      'DELETE FROM serah_terima WHERE id = ?',
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    }

    res.json({ message: 'Transaksi berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus transaksi' });
  }
});

// POST simpan transaksi serah terima baru
// Body: { ruangan, tanggal, detail: [{ jenis_linen_id, jumlah_kotor, jumlah_diambil_infeksius, jumlah_diambil_non_infeksius, keterangan }] }
router.post('/', async (req, res) => {
  const { ruangan, tanggal, detail, nama_penerima, tanda_tangan } = req.body;

  if (!ruangan || !tanggal) {
    return res.status(400).json({ error: 'Ruangan dan tanggal wajib diisi' });
  }
  if (!Array.isArray(detail) || detail.length === 0) {
    return res.status(400).json({ error: 'Detail linen tidak boleh kosong' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [headerResult] = await connection.query(
      'INSERT INTO serah_terima (ruangan, tanggal, nama_penerima, tanda_tangan) VALUES (?, ?, ?, ?)',
      [ruangan, tanggal, nama_penerima || null, tanda_tangan || null]
    );
    const serahTerimaId = headerResult.insertId;

    for (const item of detail) {
      const jumlahKotor = item.jumlah_kotor || 0;
      const jumlahInfeksius = item.jumlah_diambil_infeksius || 0;
      const jumlahNonInfeksius = item.jumlah_diambil_non_infeksius || 0;

      if (jumlahKotor === 0 && jumlahInfeksius === 0 && jumlahNonInfeksius === 0) continue;

      await connection.query(
        `INSERT INTO serah_terima_detail
         (serah_terima_id, jenis_linen_id, jumlah_kotor, jumlah_diambil_infeksius, jumlah_diambil_non_infeksius, keterangan)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [serahTerimaId, item.jenis_linen_id, jumlahKotor, jumlahInfeksius, jumlahNonInfeksius, item.keterangan || null]
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