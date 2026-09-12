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
// GET SEMUA RUANGAN
// Semua role yang sudah login boleh membaca.
// ==========================================================
router.get('/', async (req, res) => {

  try {

    const [rows] = await db.query(
      `
      SELECT
        id,
        nama,
        urutan
      FROM ruangan
      ORDER BY urutan ASC
      `
    );

    res.json(rows);

  } catch (err) {

    console.error(
      'GET ruangan:',
      err
    );

    res.status(500).json({
      error: 'Gagal mengambil data ruangan'
    });

  }
});


// ==========================================================
// POST TAMBAH RUANGAN
// ADMIN SAJA
// ==========================================================
router.post('/', requireAdmin, async (req, res) => {

  const {
    nama
  } = req.body;


  if (!nama || !nama.trim()) {

    return res.status(400).json({
      error: 'Nama ruangan wajib diisi'
    });

  }


  try {

    const [maxRow] =
      await db.query(
        `
        SELECT MAX(urutan) AS maxUrutan
        FROM ruangan
        `
      );


    const urutanFinal =
      (maxRow[0].maxUrutan || 0) + 1;


    const [result] =
      await db.query(
        `
        INSERT INTO ruangan
        (
          nama,
          urutan
        )
        VALUES (?, ?)
        `,
        [
          nama.trim(),
          urutanFinal
        ]
      );


    res.status(201).json({
      message: 'Ruangan berhasil ditambahkan',
      id: result.insertId
    });

  } catch (err) {

    if (err.code === 'ER_DUP_ENTRY') {

      return res.status(400).json({
        error: 'Nama ruangan ini sudah ada'
      });

    }


    console.error(
      'POST ruangan:',
      err
    );

    res.status(500).json({
      error: 'Gagal menambahkan ruangan'
    });

  }

});


// ==========================================================
// PUT UPDATE RUANGAN
// ADMIN SAJA
// ==========================================================
router.put('/:id', requireAdmin, async (req, res) => {

  const {
    id
  } = req.params;

  const {
    nama,
    urutan
  } = req.body;


  if (!nama || !nama.trim()) {

    return res.status(400).json({
      error: 'Nama ruangan wajib diisi'
    });

  }


  try {

    const [result] =
      await db.query(
        `
        UPDATE ruangan
        SET
          nama = ?,
          urutan = ?
        WHERE id = ?
        `,
        [
          nama.trim(),
          urutan || 0,
          id
        ]
      );


    if (result.affectedRows === 0) {

      return res.status(404).json({
        error: 'Ruangan tidak ditemukan'
      });

    }


    res.json({
      message: 'Ruangan berhasil diperbarui'
    });

  } catch (err) {

    if (err.code === 'ER_DUP_ENTRY') {

      return res.status(400).json({
        error: 'Nama ruangan ini sudah ada'
      });

    }


    console.error(
      'PUT ruangan:',
      err
    );

    res.status(500).json({
      error: 'Gagal memperbarui ruangan'
    });

  }

});


// ==========================================================
// DELETE HAPUS RUANGAN
// ADMIN SAJA
// ==========================================================
//
// Ruangan tidak boleh dihapus kalau sudah pernah digunakan
// dalam transaksi serah terima.
// ==========================================================
router.delete('/:id', requireAdmin, async (req, res) => {

  const {
    id
  } = req.params;


  try {

    // ==================================
    // CARI RUANGAN
    // ==================================
    const [rows] =
      await db.query(
        `
        SELECT nama
        FROM ruangan
        WHERE id = ?
        `,
        [id]
      );


    if (rows.length === 0) {

      return res.status(404).json({
        error: 'Ruangan tidak ditemukan'
      });

    }


    const namaRuangan =
      rows[0].nama;


    // ==================================
    // CEK TRANSAKSI
    // ==================================
    const [dipakai] =
      await db.query(
        `
        SELECT COUNT(*) AS jumlah
        FROM serah_terima
        WHERE ruangan = ?
        `,
        [namaRuangan]
      );


    if (dipakai[0].jumlah > 0) {

      return res.status(400).json({

        error:
          `Ruangan ini tidak bisa dihapus karena sudah dipakai di ${dipakai[0].jumlah} transaksi.`

      });

    }


    // ==================================
    // HAPUS RUANGAN
    // ==================================
    await db.query(
      `
      DELETE FROM ruangan
      WHERE id = ?
      `,
      [id]
    );


    res.json({
      message: 'Ruangan berhasil dihapus'
    });


  } catch (err) {

    console.error(
      'DELETE ruangan:',
      err
    );

    res.status(500).json({
      error: 'Gagal menghapus ruangan'
    });

  }

});


module.exports = router;