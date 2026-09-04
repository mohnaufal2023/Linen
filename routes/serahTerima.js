const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET daftar semua transaksi serah terima, terbaru duluan
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT id, ruangan, tanggal, created_at
       FROM serah_terima
       ORDER BY created_at DESC`
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
    // Ambil header transaksi
    const [headerRows] = await db.query(
      'SELECT id, ruangan, tanggal, created_at FROM serah_terima WHERE id = ?',
      [id]
    );

    if (headerRows.length === 0) {
      return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    }

    // Ambil detail linen, join ke jenis_linen supaya dapat namanya juga
    const [detailRows] = await db.query(
      `SELECT d.id, d.jenis_linen_id, l.nama AS jenis_linen_nama,
              d.jumlah_kotor, d.jumlah_bersih, d.keterangan
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

// PUT update satu transaksi (ganti header + seluruh detail linennya)
// Body yang diharapkan sama seperti POST:
// { "ruangan": "...", "tanggal": "...", "detail": [ { jenis_linen_id, jumlah_kotor, jumlah_bersih, keterangan }, ... ] }
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { ruangan, tanggal, detail } = req.body;

  if (!ruangan || !tanggal) {
    return res.status(400).json({ error: 'Ruangan dan tanggal wajib diisi' });
  }
  if (!Array.isArray(detail) || detail.length === 0) {
    return res.status(400).json({ error: 'Detail linen tidak boleh kosong' });
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // 1. Pastikan transaksinya ada, sekaligus update header
    const [updateResult] = await connection.query(
      'UPDATE serah_terima SET ruangan = ?, tanggal = ? WHERE id = ?',
      [ruangan, tanggal, id]
    );

    if (updateResult.affectedRows === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
    }

    // 2. Hapus semua detail lama, lalu masukkan ulang yang baru
    //    (lebih sederhana & aman daripada mencocokkan baris satu-satu)
    await connection.query(
      'DELETE FROM serah_terima_detail WHERE serah_terima_id = ?',
      [id]
    );

    for (const item of detail) {
      const jumlahKotor = item.jumlah_kotor || 0;
      const jumlahBersih = item.jumlah_bersih || 0;

      if (jumlahKotor === 0 && jumlahBersih === 0) continue;

      await connection.query(
        `INSERT INTO serah_terima_detail
         (serah_terima_id, jenis_linen_id, jumlah_kotor, jumlah_bersih, keterangan)
         VALUES (?, ?, ?, ?, ?)`,
        [id, item.jenis_linen_id, jumlahKotor, jumlahBersih, item.keterangan || null]
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
      'INSERT INTO serah_terima (ruangan, tanggal) VALUES (?, ?)',
      [ruangan, tanggal]
    );
    const serahTerimaId = headerResult.insertId;

    for (const item of detail) {
      const jumlahKotor = item.jumlah_kotor || 0;
      const jumlahBersih = item.jumlah_bersih || 0;

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