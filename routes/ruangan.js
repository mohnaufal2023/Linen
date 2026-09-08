const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET semua ruangan, diurutkan sesuai kolom "urutan"
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nama, urutan FROM ruangan ORDER BY urutan ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data ruangan' });
  }
});

// POST tambah ruangan baru
router.post('/', async (req, res) => {
  const { nama } = req.body;

  if (!nama || !nama.trim()) {
    return res.status(400).json({ error: 'Nama ruangan wajib diisi' });
  }

  try {
    const [maxRow] = await db.query('SELECT MAX(urutan) AS maxUrutan FROM ruangan');
    const urutanFinal = (maxRow[0].maxUrutan || 0) + 1;

    const [result] = await db.query(
      'INSERT INTO ruangan (nama, urutan) VALUES (?, ?)',
      [nama.trim(), urutanFinal]
    );

    res.status(201).json({ message: 'Ruangan berhasil ditambahkan', id: result.insertId });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Nama ruangan ini sudah ada' });
    }
    console.error(err);
    res.status(500).json({ error: 'Gagal menambahkan ruangan' });
  }
});

// PUT update ruangan (nama dan/atau urutan)
router.put('/:id', async (req, res) => {
  const { id } = req.params;
  const { nama, urutan } = req.body;

  if (!nama || !nama.trim()) {
    return res.status(400).json({ error: 'Nama ruangan wajib diisi' });
  }

  try {
    const [result] = await db.query(
      'UPDATE ruangan SET nama = ?, urutan = ? WHERE id = ?',
      [nama.trim(), urutan || 0, id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Ruangan tidak ditemukan' });
    }

    res.json({ message: 'Ruangan berhasil diperbarui' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'Nama ruangan ini sudah ada' });
    }
    console.error(err);
    res.status(500).json({ error: 'Gagal memperbarui ruangan' });
  }
});

// DELETE hapus ruangan
// Ditolak kalau ruangan ini masih dipakai di transaksi (serah_terima),
// supaya riwayat transaksi lama tidak jadi rusak/kehilangan data.
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.query('SELECT nama FROM ruangan WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Ruangan tidak ditemukan' });
    }
    const namaRuangan = rows[0].nama;

    const [dipakai] = await db.query(
      'SELECT COUNT(*) AS jumlah FROM serah_terima WHERE ruangan = ?',
      [namaRuangan]
    );

    if (dipakai[0].jumlah > 0) {
      return res.status(400).json({
        error: `Ruangan ini tidak bisa dihapus karena sudah dipakai di ${dipakai[0].jumlah} transaksi.`
      });
    }

    await db.query('DELETE FROM ruangan WHERE id = ?', [id]);
    res.json({ message: 'Ruangan berhasil dihapus' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal menghapus ruangan' });
  }
});

module.exports = router;