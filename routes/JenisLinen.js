const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET semua jenis linen, diurutkan sesuai kolom "urutan"
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nama, urutan, jumlah_stok FROM jenis_linen ORDER BY urutan ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data jenis linen' });
  }
});

// POST tambah jenis linen baru
router.post('/', async (req, res) => {
  const { nama, urutan } = req.body;

  if (!nama || !nama.trim()) {
    return res.status(400).json({ error: 'Nama jenis linen wajib diisi' });
  }

  try {
    // Kalau urutan tidak dikirim, taruh di paling akhir
    let urutanFinal = urutan;
    if (urutanFinal === undefined || urutanFinal === null || urutanFinal === '') {
      const [maxRow] = await db.query('SELECT MAX(urutan) AS maxUrutan FROM jenis_linen');
      urutanFinal = (maxRow[0].maxUrutan || 0) + 1;
    }

    const [result] = await db.query(
      'INSERT INTO jenis_linen (nama, urutan, jumlah_stok) VALUES (?, ?, 0)',
      [nama.trim(), urutanFinal]
    );

    res.status(201).json({ message: 'Jenis linen berhasil ditambahkan', id: result.insertId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menambahkan jenis linen' });
  }
});

// PUT update jenis linen (nama, urutan, dan/atau jumlah stok)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { nama, urutan, jumlah_stok } = req.body;

  if (!nama || !nama.trim()) {
    return res.status(400).json({ error: 'Nama jenis linen wajib diisi' });
  }

  try {
    const [result] = await db.query(
      'UPDATE jenis_linen SET nama = ?, urutan = ?, jumlah_stok = ? WHERE id = ?',
      [nama.trim(), urutan || 0, jumlah_stok || 0, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Jenis linen tidak ditemukan' });
    }

    res.json({ message: 'Jenis linen berhasil diperbarui' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui jenis linen' });
  }
});

// DELETE hapus jenis linen
// Ditolak kalau jenis linen ini masih dipakai di transaksi (serah_terima_detail),
// supaya riwayat transaksi lama tidak jadi rusak/kehilangan data.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [dipakai] = await db.query(
      'SELECT COUNT(*) AS jumlah FROM serah_terima_detail WHERE jenis_linen_id = ?',
      [id]
    );

    if (dipakai[0].jumlah > 0) {
      return res.status(400).json({
        error: `Jenis linen ini tidak bisa dihapus karena sudah dipakai di ${dipakai[0].jumlah} transaksi.`
      });
    }

    const [result] = await db.query('DELETE FROM jenis_linen WHERE id = ?', [id]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Jenis linen tidak ditemukan' });
    }

    res.json({ message: 'Jenis linen berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus jenis linen' });
  }
});

module.exports = router;