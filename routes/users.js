const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');

const db = require('../config/db');

// ==========================================================
// MIDDLEWARE ADMIN
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
      error: 'Akses hanya untuk Admin'
    });
  }

  next();
}

router.use(requireAdmin);


// ==========================================================
// GET SEMUA USER
// ==========================================================
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT
        u.id,
        u.username,
        u.role,
        u.ruangan_id,
        r.nama AS ruangan_nama,
        u.created_at
      FROM users u
      LEFT JOIN ruangan r
        ON r.id = u.ruangan_id
      ORDER BY u.id DESC
    `);

    res.json(rows);

  } catch (err) {
    console.error('GET users:', err);

    res.status(500).json({
      error: 'Gagal mengambil data user'
    });
  }
});


// ==========================================================
// GET USER BERDASARKAN ID
// ==========================================================
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const [rows] = await db.query(`
      SELECT
        u.id,
        u.username,
        u.role,
        u.ruangan_id,
        r.nama AS ruangan_nama,
        u.created_at
      FROM users u
      LEFT JOIN ruangan r
        ON r.id = u.ruangan_id
      WHERE u.id = ?
      LIMIT 1
    `, [id]);

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'User tidak ditemukan'
      });
    }

    res.json(rows[0]);

  } catch (err) {
    console.error('GET user detail:', err);

    res.status(500).json({
      error: 'Gagal mengambil data user'
    });
  }
});


// ==========================================================
// TAMBAH USER
// ==========================================================
router.post('/', async (req, res) => {
  const {
    username,
    password,
    role,
    ruangan_id
  } = req.body;

  // ========================================================
  // VALIDASI DASAR
  // ========================================================
  if (!username || !password || !role) {
    return res.status(400).json({
      error: 'Username, password, dan role wajib diisi'
    });
  }

  // ========================================================
  // ROLE YANG BOLEH DIBUAT
  // ========================================================
  if (!['user', 'laundry'].includes(role)) {
    return res.status(400).json({
      error: 'Role hanya boleh User atau Laundry'
    });
  }

  // ========================================================
  // USER WAJIB PUNYA RUANGAN
  // LAUNDRY TIDAK PERLU RUANGAN
  // ========================================================
  let finalRuanganId = null;

  if (role === 'user') {

    if (!ruangan_id) {
      return res.status(400).json({
        error: 'User wajib memilih ruangan'
      });
    }

    finalRuanganId = Number(ruangan_id);

    if (!Number.isInteger(finalRuanganId) || finalRuanganId <= 0) {
      return res.status(400).json({
        error: 'Ruangan tidak valid'
      });
    }

  }

  try {

    // ======================================================
    // CEK USERNAME
    // ======================================================
    const [existing] = await db.query(`
      SELECT id
      FROM users
      WHERE username = ?
      LIMIT 1
    `, [username]);

    if (existing.length > 0) {
      return res.status(400).json({
        error: 'Username sudah digunakan'
      });
    }


    // ======================================================
    // CEK RUANGAN
    // ======================================================
    if (role === 'user') {

      const [ruangan] = await db.query(`
        SELECT id
        FROM ruangan
        WHERE id = ?
        LIMIT 1
      `, [finalRuanganId]);

      if (ruangan.length === 0) {
        return res.status(400).json({
          error: 'Ruangan tidak ditemukan'
        });
      }


      // ====================================================
      // SATU RUANGAN HANYA BOLEH MEMILIKI SATU USER
      // ====================================================
      const [userRuangan] = await db.query(`
        SELECT id, username
        FROM users
        WHERE ruangan_id = ?
          AND role = 'user'
        LIMIT 1
      `, [finalRuanganId]);

      if (userRuangan.length > 0) {
        return res.status(400).json({
          error:
            `Ruangan tersebut sudah memiliki akun User: ${userRuangan[0].username}`
        });
      }

    }


    // ======================================================
    // HASH PASSWORD
    // ======================================================
    const hashedPassword = await bcrypt.hash(password, 10);


    // ======================================================
    // INSERT USER
    // ======================================================
    const [result] = await db.query(`
      INSERT INTO users (
        username,
        password,
        role,
        ruangan_id
      )
      VALUES (?, ?, ?, ?)
    `, [
      username,
      hashedPassword,
      role,
      finalRuanganId
    ]);


    res.status(201).json({
      message: 'User berhasil ditambahkan',
      id: result.insertId
    });

  } catch (err) {

    console.error('POST users:', err);

    res.status(500).json({
      error: 'Gagal menambahkan user'
    });

  }
});


// ==========================================================
// UPDATE USER
// ==========================================================
router.put('/:id', async (req, res) => {

  const { id } = req.params;

  const {
    username,
    password,
    role,
    ruangan_id
  } = req.body;


  // ========================================================
  // VALIDASI
  // ========================================================
  if (!username || !role) {
    return res.status(400).json({
      error: 'Username dan role wajib diisi'
    });
  }


  if (!['user', 'laundry'].includes(role)) {
    return res.status(400).json({
      error: 'Role hanya boleh User atau Laundry'
    });
  }


  let finalRuanganId = null;


  if (role === 'user') {

    if (!ruangan_id) {
      return res.status(400).json({
        error: 'User wajib memilih ruangan'
      });
    }

    finalRuanganId = Number(ruangan_id);

    if (!Number.isInteger(finalRuanganId) || finalRuanganId <= 0) {
      return res.status(400).json({
        error: 'Ruangan tidak valid'
      });
    }

  }


  try {

    // ======================================================
    // CEK USER
    // ======================================================
    const [users] = await db.query(`
      SELECT id
      FROM users
      WHERE id = ?
      LIMIT 1
    `, [id]);

    if (users.length === 0) {
      return res.status(404).json({
        error: 'User tidak ditemukan'
      });
    }


    // ======================================================
    // CEK USERNAME MILIK USER LAIN
    // ======================================================
    const [existing] = await db.query(`
      SELECT id
      FROM users
      WHERE username = ?
      AND id <> ?
      LIMIT 1
    `, [username, id]);

    if (existing.length > 0) {
      return res.status(400).json({
        error: 'Username sudah digunakan'
      });
    }


    // ======================================================
    // CEK RUANGAN
    // ======================================================
    if (role === 'user') {

      const [ruangan] = await db.query(`
        SELECT id
        FROM ruangan
        WHERE id = ?
        LIMIT 1
      `, [finalRuanganId]);

      if (ruangan.length === 0) {
        return res.status(400).json({
          error: 'Ruangan tidak ditemukan'
        });
      }


      // ====================================================
      // CEK USER LAIN PADA RUANGAN YANG SAMA
      // ====================================================
      const [userRuangan] = await db.query(`
        SELECT id, username
        FROM users
        WHERE ruangan_id = ?
          AND role = 'user'
          AND id <> ?
        LIMIT 1
      `, [finalRuanganId, id]);

      if (userRuangan.length > 0) {
        return res.status(400).json({
          error:
            `Ruangan tersebut sudah memiliki akun User: ${userRuangan[0].username}`
        });
      }

    }


    // ======================================================
    // UPDATE TANPA PASSWORD
    // ======================================================
    if (!password) {

      await db.query(`
        UPDATE users
        SET
          username = ?,
          role = ?,
          ruangan_id = ?
        WHERE id = ?
      `, [
        username,
        role,
        finalRuanganId,
        id
      ]);

    }

    // ======================================================
    // UPDATE DENGAN PASSWORD BARU
    // ======================================================
    else {

      const hashedPassword = await bcrypt.hash(password, 10);

      await db.query(`
        UPDATE users
        SET
          username = ?,
          password = ?,
          role = ?,
          ruangan_id = ?
        WHERE id = ?
      `, [
        username,
        hashedPassword,
        role,
        finalRuanganId,
        id
      ]);

    }


    res.json({
      message: 'User berhasil diperbarui'
    });

  } catch (err) {

    console.error('PUT users:', err);

    res.status(500).json({
      error: 'Gagal memperbarui user'
    });

  }
});


// ==========================================================
// HAPUS USER
// ==========================================================
router.delete('/:id', async (req, res) => {

  const { id } = req.params;

  try {

    // ======================================================
    // CEK USER
    // ======================================================
    const [users] = await db.query(`
      SELECT
        id,
        username,
        role
      FROM users
      WHERE id = ?
      LIMIT 1
    `, [id]);

    if (users.length === 0) {
      return res.status(404).json({
        error: 'User tidak ditemukan'
      });
    }


    // ======================================================
    // CEK APAKAH USER PERNAH MEMBUAT TRANSAKSI
    // ======================================================
    const [dibuat] = await db.query(`
      SELECT id
      FROM serah_terima
      WHERE dibuat_oleh_user_id = ?
      LIMIT 1
    `, [id]);


    // ======================================================
    // CEK APAKAH USER PERNAH MENERIMA TRANSAKSI
    // ======================================================
    const [diterima] = await db.query(`
      SELECT id
      FROM serah_terima
      WHERE diterima_oleh_user_id = ?
      LIMIT 1
    `, [id]);


    if (dibuat.length > 0 || diterima.length > 0) {
      return res.status(400).json({
        error:
          'User tidak dapat dihapus karena sudah memiliki riwayat transaksi'
      });
    }


    // ======================================================
    // HAPUS USER
    // ======================================================
    await db.query(`
      DELETE FROM users
      WHERE id = ?
    `, [id]);


    res.json({
      message: 'User berhasil dihapus'
    });

  } catch (err) {

    console.error('DELETE users:', err);

    res.status(500).json({
      error: 'Gagal menghapus user'
    });

  }
});


module.exports = router;