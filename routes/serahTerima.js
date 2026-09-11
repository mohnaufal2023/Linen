const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ============================================================
// HELPER AKSES USER
// ============================================================
async function getAccessInfo(req) {
  const user = req.session?.user;

  if (!user) {
    return {
      error: 'Silakan login terlebih dahulu'
    };
  }

  // ADMIN
  if (user.role === 'admin') {
    return {
      role: 'admin',
      userId: null,
      ruangan_id: null,
      ruangan_nama: null
    };
  }

  // LAUNDRY
  if (user.role === 'laundry') {
    return {
      role: 'laundry',
      userId: user.id,
      ruangan_id: null,
      ruangan_nama: null
    };
  }

  // USER RUANGAN
  if (user.role === 'user') {
    if (!user.ruangan_id) {
      return {
        error: 'Akun user belum terhubung dengan ruangan'
      };
    }

    try {
      const [rows] = await db.query(
        `SELECT id, nama
         FROM ruangan
         WHERE id = ?
         LIMIT 1`,
        [user.ruangan_id]
      );

      if (rows.length === 0) {
        return {
          error: 'Ruangan akun user tidak ditemukan'
        };
      }

      return {
        role: 'user',
        userId: user.id,
        ruangan_id: rows[0].id,
        ruangan_nama: rows[0].nama
      };

    } catch (err) {
      console.error('Error cek ruangan:', err);

      return {
        error: 'Gagal memeriksa ruangan user'
      };
    }
  }

  return {
    error: 'Role akun tidak dikenali'
  };
}

// ============================================================
// GET SEMUA TRANSAKSI
// ============================================================
// ADMIN   : semua
// LAUNDRY : semua
// USER    : hanya ruangan sendiri
// ============================================================
router.get('/', async (req, res) => {
  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error
      });
    }

    let query = `
      SELECT
        st.id,
        st.ruangan,
        st.tanggal,
        st.status,
        st.created_at,
        st.dibuat_oleh_user_id,
        st.nama_penerima,
        st.diterima_oleh_user_id,
        st.diterima_at,

        COALESCE(SUM(d.jumlah_kotor), 0) AS total_kotor,

        COALESCE(
          SUM(d.jumlah_diambil_infeksius),
          0
        ) AS total_infeksius,

        COALESCE(
          SUM(d.jumlah_diambil_non_infeksius),
          0
        ) AS total_non_infeksius,

        COALESCE(
          SUM(
            d.jumlah_diambil_infeksius +
            d.jumlah_diambil_non_infeksius
          ),
          0
        ) AS total_bersih

      FROM serah_terima st

      LEFT JOIN serah_terima_detail d
        ON d.serah_terima_id = st.id
    `;

    const params = [];

    // User hanya melihat transaksi ruangan sendiri
    if (access.role === 'user') {
      query += `
        WHERE st.ruangan = ?
      `;

      params.push(access.ruangan_nama);
    }

    query += `
      GROUP BY
        st.id,
        st.ruangan,
        st.tanggal,
        st.status,
        st.created_at,
        st.dibuat_oleh_user_id,
        st.nama_penerima,
        st.diterima_oleh_user_id,
        st.diterima_at

      ORDER BY st.created_at DESC
    `;

    const [rows] = await db.query(query, params);

    res.json(rows);

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Gagal mengambil data riwayat'
    });
  }
});

// ============================================================
// GET DETAIL TRANSAKSI
// ============================================================
router.get('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error
      });
    }

    let headerQuery = `
      SELECT
        id,
        ruangan,
        tanggal,
        status,
        created_at,
        dibuat_oleh_user_id,
        nama_penerima,
        tanda_tangan,
        diterima_oleh_user_id,
        diterima_at
      FROM serah_terima
      WHERE id = ?
    `;

    const headerParams = [id];

    if (access.role === 'user') {
      headerQuery += `
        AND ruangan = ?
      `;

      headerParams.push(access.ruangan_nama);
    }

    const [headerRows] = await db.query(
      headerQuery,
      headerParams
    );

    if (headerRows.length === 0) {
      return res.status(404).json({
        error: 'Transaksi tidak ditemukan atau bukan milik ruangan Anda'
      });
    }

    const [detailRows] = await db.query(
      `SELECT
        d.id,
        d.jenis_linen_id,
        l.nama AS jenis_linen_nama,

        d.jumlah_kotor,

        d.jumlah_diambil_infeksius,

        d.jumlah_diambil_non_infeksius,

        d.verifikasi_infeksius,

        d.verifikasi_pengambilan,

        d.keterangan

       FROM serah_terima_detail d

       JOIN jenis_linen l
         ON l.id = d.jenis_linen_id

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

    res.status(500).json({
      error: 'Gagal mengambil detail transaksi'
    });
  }
});

// ============================================================
// VERIFIKASI PENGAMBILAN
// ============================================================
// ADMIN   : boleh
// LAUNDRY : boleh
// USER    : tidak boleh
//
// Verifikasi hanya tersedia jika:
// infeksius > 0 ATAU non-infeksius > 0
// ============================================================
router.put(
  '/detail/:detailId/verifikasi',
  async (req, res) => {

    const { detailId } = req.params;

    try {
      const access = await getAccessInfo(req);

      if (access.error) {
        return res.status(403).json({
          error: access.error
        });
      }

      // User ruangan tidak boleh melakukan verifikasi
      if (
        access.role !== 'admin' &&
        access.role !== 'laundry'
      ) {
        return res.status(403).json({
          error: 'Hanya Laundry atau Admin yang dapat melakukan verifikasi'
        });
      }

      const [rows] = await db.query(
        `SELECT
          d.id,
          d.jumlah_diambil_infeksius,
          d.jumlah_diambil_non_infeksius,
          st.ruangan
         FROM serah_terima_detail d
         JOIN serah_terima st
           ON st.id = d.serah_terima_id
         WHERE d.id = ?
         LIMIT 1`,
        [detailId]
      );

      if (rows.length === 0) {
        return res.status(404).json({
          error: 'Detail transaksi tidak ditemukan'
        });
      }

      const item = rows[0];

      const adaPengambilan =
        Number(item.jumlah_diambil_infeksius) > 0 ||
        Number(item.jumlah_diambil_non_infeksius) > 0;

      // Tidak ada yang diambil
      if (!adaPengambilan) {
        return res.status(400).json({
          error: 'Tidak perlu verifikasi karena tidak ada linen yang diambil'
        });
      }

      await db.query(
        `UPDATE serah_terima_detail
         SET verifikasi_pengambilan = 1
         WHERE id = ?`,
        [detailId]
      );

      res.json({
        message: 'Pengambilan berhasil diverifikasi'
      });

    } catch (err) {
      console.error(err);

      res.status(500).json({
        error: 'Gagal melakukan verifikasi'
      });
    }
  }
);

// ============================================================
// UPDATE TRANSAKSI
// ============================================================
// ADMIN   : boleh edit
// LAUNDRY : boleh edit
// USER    : tidak boleh edit
// ============================================================
router.put('/:id', async (req, res) => {
  const { id } = req.params;

  const {
    ruangan,
    tanggal,
    detail
  } = req.body;

  if (!tanggal) {
    return res.status(400).json({
      error: 'Tanggal wajib diisi'
    });
  }

  if (!Array.isArray(detail) || detail.length === 0) {
    return res.status(400).json({
      error: 'Detail linen tidak boleh kosong'
    });
  }

  const access = await getAccessInfo(req);

  if (access.error) {
    return res.status(403).json({
      error: access.error
    });
  }

  if (
    access.role !== 'admin' &&
    access.role !== 'laundry'
  ) {
    return res.status(403).json({
      error: 'User ruangan tidak dapat mengedit transaksi'
    });
  }

  if (!ruangan || !ruangan.trim()) {
    return res.status(400).json({
      error: 'Ruangan wajib diisi'
    });
  }

  const connection = await db.getConnection();

  try {
    const [existingRows] = await connection.query(
      `SELECT id
       FROM serah_terima
       WHERE id = ?
       LIMIT 1`,
      [id]
    );

    if (existingRows.length === 0) {
      connection.release();

      return res.status(404).json({
        error: 'Transaksi tidak ditemukan'
      });
    }

    await connection.beginTransaction();

    // Update header
    await connection.query(
      `UPDATE serah_terima
       SET
         ruangan = ?,
         tanggal = ?
       WHERE id = ?`,
      [
        ruangan.trim(),
        tanggal,
        id
      ]
    );

    // Hapus detail lama
    await connection.query(
      `DELETE FROM serah_terima_detail
       WHERE serah_terima_id = ?`,
      [id]
    );

    // Masukkan detail baru
    for (const item of detail) {

      const jumlahKotor =
        Number(item.jumlah_kotor) || 0;

      const jumlahInfeksius =
        Number(item.jumlah_diambil_infeksius) || 0;

      const jumlahNonInfeksius =
        Number(item.jumlah_diambil_non_infeksius) || 0;

      if (
        jumlahKotor === 0 &&
        jumlahInfeksius === 0 &&
        jumlahNonInfeksius === 0
      ) {
        continue;
      }

      const perluVerifikasi =
        jumlahInfeksius > 0 ||
        jumlahNonInfeksius > 0;

      await connection.query(
        `INSERT INTO serah_terima_detail
        (
          serah_terima_id,
          jenis_linen_id,
          jumlah_kotor,
          jumlah_diambil_infeksius,
          jumlah_diambil_non_infeksius,
          verifikasi_infeksius,
          verifikasi_pengambilan,
          keterangan
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          item.jenis_linen_id,
          jumlahKotor,
          jumlahInfeksius,
          jumlahNonInfeksius,
          0,
          perluVerifikasi ? 0 : 0,
          item.keterangan || null
        ]
      );
    }

    await connection.commit();

    res.json({
      message: 'Transaksi berhasil diperbarui'
    });

  } catch (err) {

    await connection.rollback();

    console.error(err);

    res.status(500).json({
      error: 'Gagal memperbarui transaksi'
    });

  } finally {
    connection.release();
  }
});

// ============================================================
// DELETE TRANSAKSI
// ============================================================
// ADMIN   : boleh
// LAUNDRY : boleh
// USER    : tidak boleh
// ============================================================
router.delete('/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error
      });
    }

    if (
      access.role !== 'admin' &&
      access.role !== 'laundry'
    ) {
      return res.status(403).json({
        error: 'User ruangan tidak dapat menghapus transaksi'
      });
    }

    const [result] = await db.query(
      `DELETE FROM serah_terima
       WHERE id = ?`,
      [id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({
        error: 'Transaksi tidak ditemukan'
      });
    }

    res.json({
      message: 'Transaksi berhasil dihapus'
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: 'Gagal menghapus transaksi'
    });
  }
});

// ============================================================
// POST TRANSAKSI BARU
// ============================================================
// ADMIN   : boleh
// LAUNDRY : boleh
// USER    : TIDAK BOLEH
//
// Nama + tanda tangan tidak lagi diisi Laundry.
// Itu akan diisi user ruangan saat konfirmasi.
// ============================================================
router.post('/', async (req, res) => {

  const {
    ruangan,
    tanggal,
    detail
  } = req.body;

  if (!ruangan || !ruangan.trim()) {
    return res.status(400).json({
      error: 'Ruangan wajib diisi'
    });
  }

  if (!tanggal) {
    return res.status(400).json({
      error: 'Tanggal wajib diisi'
    });
  }

  if (!Array.isArray(detail) || detail.length === 0) {
    return res.status(400).json({
      error: 'Detail linen tidak boleh kosong'
    });
  }

  try {

    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error
      });
    }

    // User ruangan tidak boleh membuat transaksi
    if (
      access.role !== 'admin' &&
      access.role !== 'laundry'
    ) {
      return res.status(403).json({
        error: 'Hanya Laundry atau Admin yang dapat membuat transaksi'
      });
    }

    const connection = await db.getConnection();

    try {

      await connection.beginTransaction();

      // ======================================================
      // INSERT HEADER
      // ======================================================
      const [headerResult] = await connection.query(
        `INSERT INTO serah_terima
        (
          ruangan,
          tanggal,
          status,
          dibuat_oleh_user_id
        )
        VALUES (?, ?, 'menunggu_konfirmasi', ?)`,
        [
          ruangan.trim(),
          tanggal,
          access.userId
        ]
      );

      const serahTerimaId =
        headerResult.insertId;

      // ======================================================
      // INSERT DETAIL
      // ======================================================
      for (const item of detail) {

        const jumlahKotor =
          Number(item.jumlah_kotor) || 0;

        const jumlahInfeksius =
          Number(item.jumlah_diambil_infeksius) || 0;

        const jumlahNonInfeksius =
          Number(item.jumlah_diambil_non_infeksius) || 0;

        if (
          jumlahKotor === 0 &&
          jumlahInfeksius === 0 &&
          jumlahNonInfeksius === 0
        ) {
          continue;
        }

        await connection.query(
          `INSERT INTO serah_terima_detail
          (
            serah_terima_id,
            jenis_linen_id,
            jumlah_kotor,
            jumlah_diambil_infeksius,
            jumlah_diambil_non_infeksius,
            verifikasi_infeksius,
            verifikasi_pengambilan,
            keterangan
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            serahTerimaId,
            item.jenis_linen_id,
            jumlahKotor,
            jumlahInfeksius,
            jumlahNonInfeksius,
            0,
            0,
            item.keterangan || null
          ]
        );
      }

      await connection.commit();

      res.status(201).json({
        message: 'Data serah terima berhasil disimpan',
        id: serahTerimaId,
        ruangan: ruangan.trim(),
        status: 'menunggu_konfirmasi'
      });

    } catch (err) {

      await connection.rollback();

      console.error(err);

      res.status(500).json({
        error: 'Gagal menyimpan data serah terima'
      });

    } finally {

      connection.release();
    }

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: 'Gagal memproses transaksi'
    });
  }
});

// ============================================================
// KONFIRMASI PENERIMAAN
// ============================================================
// HANYA USER RUANGAN
//
// User mengisi:
// - nama penerima
// - tanda tangan
//
// Lalu status menjadi selesai.
// ============================================================
router.put('/:id/konfirmasi', async (req, res) => {

  const { id } = req.params;

  const {
    nama_penerima,
    tanda_tangan
  } = req.body;

  if (
    !nama_penerima ||
    !nama_penerima.trim()
  ) {
    return res.status(400).json({
      error: 'Nama penerima wajib diisi'
    });
  }

  if (!tanda_tangan) {
    return res.status(400).json({
      error: 'Tanda tangan wajib diisi'
    });
  }

  try {

    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error
      });
    }

    // Hanya user ruangan
    if (access.role !== 'user') {
      return res.status(403).json({
        error: 'Hanya user ruangan yang dapat melakukan konfirmasi'
      });
    }

    const [rows] = await db.query(
      `SELECT
        id,
        ruangan,
        status
       FROM serah_terima
       WHERE id = ?
         AND ruangan = ?
       LIMIT 1`,
      [
        id,
        access.ruangan_nama
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        error: 'Transaksi tidak ditemukan atau bukan milik ruangan Anda'
      });
    }

    const transaksi = rows[0];

    if (transaksi.status === 'selesai') {
      return res.status(400).json({
        error: 'Transaksi ini sudah dikonfirmasi'
      });
    }

    await db.query(
      `UPDATE serah_terima
       SET
         status = 'selesai',
         nama_penerima = ?,
         tanda_tangan = ?,
         diterima_oleh_user_id = ?,
         diterima_at = NOW()
       WHERE id = ?`,
      [
        nama_penerima.trim(),
        tanda_tangan,
        access.userId,
        id
      ]
    );

    res.json({
      message: 'Penerimaan berhasil dikonfirmasi',
      status: 'selesai'
    });

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: 'Gagal melakukan konfirmasi penerimaan'
    });
  }
});

module.exports = router;