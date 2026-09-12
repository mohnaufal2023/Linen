const express = require('express');
const router = express.Router();
const db = require('../config/db');


// ==========================================================
// MIDDLEWARE ADMIN SAJA
// ==========================================================
function requireAdmin(req, res, next) {

  const user = req.session?.user;

  if (!req.session?.loggedIn || !user) {
    return res.status(401).json({
      error: 'Silakan login terlebih dahulu'
    });
  }

  if (user.role !== 'admin') {
    return res.status(403).json({
      error: 'Akses hanya untuk admin'
    });
  }

  next();
}


// ==========================================================
// GET SEMUA JENIS LINEN
// Semua role yang sudah login boleh membaca.
// ==========================================================
router.get('/', async (req, res) => {

  try {

    const [rows] = await db.query(
      `
      SELECT
        id,
        nama,
        urutan,
        jumlah_stok
      FROM jenis_linen
      ORDER BY urutan ASC
      `
    );

    res.json(rows);

  } catch (err) {

    console.error(
      'GET jenis linen:',
      err
    );

    res.status(500).json({
      error: 'Gagal mengambil data jenis linen'
    });

  }
});


// ==========================================================
// POST TAMBAH JENIS LINEN
// ADMIN SAJA
// ==========================================================
router.post('/', requireAdmin, async (req, res) => {

  const {
    nama,
    urutan
  } = req.body;


  if (!nama || !nama.trim()) {

    return res.status(400).json({
      error: 'Nama jenis linen wajib diisi'
    });

  }


  try {

    // Kalau urutan tidak dikirim,
    // taruh di posisi paling akhir.
    let urutanFinal = urutan;


    if (
      urutanFinal === undefined ||
      urutanFinal === null ||
      urutanFinal === ''
    ) {

      const [maxRow] =
        await db.query(
          `
          SELECT MAX(urutan) AS maxUrutan
          FROM jenis_linen
          `
        );

      urutanFinal =
        (maxRow[0].maxUrutan || 0) + 1;

    }


    const [result] =
      await db.query(
        `
        INSERT INTO jenis_linen
        (
          nama,
          urutan,
          jumlah_stok
        )
        VALUES (?, ?, 0)
        `,
        [
          nama.trim(),
          urutanFinal
        ]
      );


    res.status(201).json({
      message: 'Jenis linen berhasil ditambahkan',
      id: result.insertId
    });

  } catch (err) {

    console.error(
      'POST jenis linen:',
      err
    );

    res.status(500).json({
      error: 'Gagal menambahkan jenis linen'
    });

  }

});


// ==========================================================
// PUT UPDATE JENIS LINEN
// ADMIN SAJA
// ==========================================================
router.put('/:id', requireAdmin, async (req, res) => {

  const {
    id
  } = req.params;

  const {
    nama,
    urutan,
    jumlah_stok
  } = req.body;


  if (!nama || !nama.trim()) {

    return res.status(400).json({
      error: 'Nama jenis linen wajib diisi'
    });

  }


  try {

    const [result] =
      await db.query(
        `
        UPDATE jenis_linen
        SET
          nama = ?,
          urutan = ?,
          jumlah_stok = ?
        WHERE id = ?
        `,
        [
          nama.trim(),
          urutan || 0,
          jumlah_stok || 0,
          id
        ]
      );


    if (result.affectedRows === 0) {

      return res.status(404).json({
        error: 'Jenis linen tidak ditemukan'
      });

    }


    res.json({
      message: 'Jenis linen berhasil diperbarui'
    });

  } catch (err) {

    console.error(
      'PUT jenis linen:',
      err
    );

    res.status(500).json({
      error: 'Gagal memperbarui jenis linen'
    });

  }

});


// ==========================================================
// DELETE HAPUS JENIS LINEN
// ADMIN SAJA
// ==========================================================
//
// Ditolak kalau jenis linen sudah pernah digunakan
// pada transaksi agar riwayat lama tetap aman.
// ==========================================================
router.delete('/:id', requireAdmin, async (req, res) => {

  const {
    id
  } = req.params;


  try {

    const [dipakai] =
      await db.query(
        `
        SELECT COUNT(*) AS jumlah
        FROM serah_terima_detail
        WHERE jenis_linen_id = ?
        `,
        [id]
      );


    if (dipakai[0].jumlah > 0) {

      return res.status(400).json({
        error:
          `Jenis linen ini tidak bisa dihapus karena sudah dipakai di ${dipakai[0].jumlah} transaksi.`
      });

    }


    const [result] =
      await db.query(
        `
        DELETE FROM jenis_linen
        WHERE id = ?
        `,
        [id]
      );


    if (result.affectedRows === 0) {

      return res.status(404).json({
        error: 'Jenis linen tidak ditemukan'
      });

    }


    res.json({
      message: 'Jenis linen berhasil dihapus'
    });

  } catch (err) {

    console.error(
      'DELETE jenis linen:',
      err
    );

    res.status(500).json({
      error: 'Gagal menghapus jenis linen'
    });

  }

});


module.exports = router;