const express = require('express');
const router = express.Router();
const db = require('../config/db');


// ==========================================================
// MIDDLEWARE AKSES
// ADMIN + LAUNDRY
// ==========================================================
function requireLaundryAccess(req, res, next) {

  const user = req.session?.user;

  if (!req.session?.loggedIn || !user) {
    return res.status(401).json({
      error: 'Silakan login terlebih dahulu'
    });
  }

  if (
    user.role !== 'admin' &&
    user.role !== 'laundry'
  ) {
    return res.status(403).json({
      error: 'Akses hanya untuk Admin atau Laundry'
    });
  }

  next();
}


router.use(requireLaundryAccess);


// ==========================================================
// GET SEMUA PROSES LAUNDRY
// ==========================================================
router.get('/', async (req, res) => {

  try {

    const [rows] = await db.query(
      `
      SELECT
        p.id,
        p.serah_terima_detail_id,
        p.jenis_linen_id,

        l.nama AS jenis_linen_nama,

        p.jumlah_infeksius,
        p.jumlah_non_infeksius,
        p.jumlah_total,

        p.status,

        p.jumlah_layak,
        p.jumlah_rusak,

        p.created_at,
        p.selesai_at,

        st.id AS serah_terima_id,
        st.ruangan,
        st.tanggal

      FROM proses_laundry p

      JOIN jenis_linen l
        ON l.id = p.jenis_linen_id

      JOIN serah_terima_detail d
        ON d.id = p.serah_terima_detail_id

      JOIN serah_terima st
        ON st.id = d.serah_terima_id

      ORDER BY
        CASE
          WHEN p.status = 'menunggu_cuci' THEN 1
          WHEN p.status = 'sedang_dicuci' THEN 2
          WHEN p.status = 'selesai' THEN 3
          ELSE 4
        END,
        p.created_at DESC
      `
    );


    res.json(rows);

  } catch (err) {

    console.error(
      'GET proses laundry:',
      err
    );

    res.status(500).json({
      error: 'Gagal mengambil data proses Laundry'
    });

  }

});


// ==========================================================
// GET DETAIL SATU PROSES
// ==========================================================
router.get('/:id', async (req, res) => {

  const {
    id
  } = req.params;


  try {

    const [rows] = await db.query(
      `
      SELECT
        p.id,
        p.serah_terima_detail_id,
        p.jenis_linen_id,

        l.nama AS jenis_linen_nama,

        p.jumlah_infeksius,
        p.jumlah_non_infeksius,
        p.jumlah_total,

        p.status,

        p.jumlah_layak,
        p.jumlah_rusak,

        p.created_at,
        p.selesai_at,

        st.id AS serah_terima_id,
        st.ruangan,
        st.tanggal

      FROM proses_laundry p

      JOIN jenis_linen l
        ON l.id = p.jenis_linen_id

      JOIN serah_terima_detail d
        ON d.id = p.serah_terima_detail_id

      JOIN serah_terima st
        ON st.id = d.serah_terima_id

      WHERE p.id = ?

      LIMIT 1
      `,
      [id]
    );


    if (rows.length === 0) {

      return res.status(404).json({
        error: 'Data proses Laundry tidak ditemukan'
      });

    }


    res.json(rows[0]);

  } catch (err) {

    console.error(
      'GET detail proses laundry:',
      err
    );

    res.status(500).json({
      error: 'Gagal mengambil detail proses Laundry'
    });

  }

});


// ==========================================================
// MULAI MENCUCI
// ==========================================================
// menunggu_cuci -> sedang_dicuci
// ==========================================================
router.put('/:id/mulai', async (req, res) => {

  const {
    id
  } = req.params;


  try {

    const [rows] = await db.query(
      `
      SELECT
        id,
        status

      FROM proses_laundry

      WHERE id = ?

      LIMIT 1
      `,
      [id]
    );


    if (rows.length === 0) {

      return res.status(404).json({
        error: 'Data proses Laundry tidak ditemukan'
      });

    }


    if (
      rows[0].status !== 'menunggu_cuci'
    ) {

      return res.status(400).json({
        error:
          'Proses ini tidak berada pada status Menunggu Dicuci'
      });

    }


    await db.query(
      `
      UPDATE proses_laundry

      SET status = 'sedang_dicuci'

      WHERE id = ?
      `,
      [id]
    );


    res.json({
      message:
        'Proses pencucian dimulai',
      status:
        'sedang_dicuci'
    });


  } catch (err) {

    console.error(
      'Mulai proses laundry:',
      err
    );

    res.status(500).json({
      error:
        'Gagal memulai proses pencucian'
    });

  }

});


// ==========================================================
// SELESAI MENCUCI
// ==========================================================
// Input:
// - jumlah_layak
// - jumlah_rusak
//
// Syarat:
// jumlah_layak + jumlah_rusak = jumlah_total
//
// Setelah berhasil:
// - stok bersih bertambah jumlah_layak
// - stok rusak bertambah jumlah_rusak
// - status menjadi selesai
// ==========================================================
router.put('/:id/selesai', async (req, res) => {

  const {
    id
  } = req.params;


  const {
    jumlah_layak,
    jumlah_rusak
  } = req.body;


  // ========================================================
  // VALIDASI INPUT
  // ========================================================
  const layak =
    Number(jumlah_layak);

  const rusak =
    Number(jumlah_rusak);


  if (
    !Number.isInteger(layak) ||
    !Number.isInteger(rusak)
  ) {

    return res.status(400).json({
      error:
        'Jumlah layak dan jumlah rusak harus berupa angka bulat'
    });

  }


  if (
    layak < 0 ||
    rusak < 0
  ) {

    return res.status(400).json({
      error:
        'Jumlah layak dan rusak tidak boleh negatif'
    });

  }


  const connection =
    await db.getConnection();


  try {

    await connection.beginTransaction();


    // ======================================================
    // AMBIL DATA PROSES + KUNCI BARIS
    // ======================================================
    const [rows] =
      await connection.query(
        `
        SELECT
          id,
          jenis_linen_id,
          jumlah_total,
          status

        FROM proses_laundry

        WHERE id = ?

        LIMIT 1

        FOR UPDATE
        `,
        [id]
      );


    if (rows.length === 0) {

      await connection.rollback();

      return res.status(404).json({
        error:
          'Data proses Laundry tidak ditemukan'
      });

    }


    const proses =
      rows[0];


    // ======================================================
    // HARUS DALAM STATUS SEDANG DICUCI
    // ======================================================
    if (
      proses.status !== 'sedang_dicuci'
    ) {

      await connection.rollback();

      return res.status(400).json({
        error:
          'Proses harus berstatus Sedang Dicuci sebelum diselesaikan'
      });

    }


    const jumlahTotal =
      Number(proses.jumlah_total);


    // ======================================================
    // VALIDASI JUMLAH
    // ======================================================
    if (
      layak + rusak !== jumlahTotal
    ) {

      await connection.rollback();

      return res.status(400).json({

        error:
          `Jumlah layak (${layak}) + ` +
          `jumlah rusak (${rusak}) harus sama dengan ` +
          `jumlah total (${jumlahTotal}).`

      });

    }


    // ======================================================
    // UPDATE STOK BERSIH
    // ======================================================
    if (layak > 0) {

      await connection.query(
        `
        UPDATE jenis_linen

        SET
          jumlah_stok = jumlah_stok + ?

        WHERE id = ?
        `,
        [
          layak,
          proses.jenis_linen_id
        ]
      );

    }


    // ======================================================
    // UPDATE STOK RUSAK
    // ======================================================
    if (rusak > 0) {

      await connection.query(
        `
        UPDATE jenis_linen

        SET
          jumlah_rusak = jumlah_rusak + ?

        WHERE id = ?
        `,
        [
          rusak,
          proses.jenis_linen_id
        ]
      );

    }


    // ======================================================
    // UPDATE PROSES LAUNDRY
    // ======================================================
    await connection.query(
      `
      UPDATE proses_laundry

      SET
        status = 'selesai',
        jumlah_layak = ?,
        jumlah_rusak = ?,
        selesai_at = NOW()

      WHERE id = ?
      `,
      [
        layak,
        rusak,
        id
      ]
    );


    // ======================================================
    // COMMIT
    // ======================================================
    await connection.commit();


    res.json({

      message:
        'Proses pencucian berhasil diselesaikan',

      status:
        'selesai',

      jumlah_total:
        jumlahTotal,

      jumlah_layak:
        layak,

      jumlah_rusak:
        rusak

    });


  } catch (err) {

    await connection.rollback();

    console.error(
      'Selesai proses laundry:',
      err
    );

    res.status(500).json({
      error:
        'Gagal menyelesaikan proses pencucian'
    });


  } finally {

    connection.release();

  }

});


module.exports = router;