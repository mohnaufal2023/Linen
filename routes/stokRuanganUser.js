const express = require('express');
const router = express.Router();
const db = require('../config/db');

// ============================================================
// AKSES USER RUANGAN
// ============================================================
function requireUser(req, res, next) {

  if (
    !req.session?.loggedIn ||
    !req.session?.user
  ) {
    return res.status(401).json({
      error: 'Silakan login terlebih dahulu'
    });
  }

  if (
    req.session.user.role !== 'user'
  ) {
    return res.status(403).json({
      error: 'Akses hanya untuk User Ruangan'
    });
  }

  if (
    !req.session.user.ruangan_id
  ) {
    return res.status(403).json({
      error: 'Akun User belum memiliki ruangan'
    });
  }

  next();
}

router.use(requireUser);


// ============================================================
// GET STOK LINEN RUANGAN SENDIRI
// ============================================================
// User hanya dapat melihat stok ruangan yang terhubung
// dengan akun login.
//
// Perhitungan:
// stok ruangan = total linen DIANTAR
//                - total linen DIAMBIL
//
// Hanya transaksi yang sudah SELESAI yang dihitung.
// ============================================================
router.get('/', async (req, res) => {

  try {

    const userId =
      req.session.user.id;

    // ========================================================
    // AMBIL RUANGAN USER
    // ========================================================
    const [userRows] = await db.query(
      `
      SELECT
        u.ruangan_id,
        r.nama AS ruangan_nama

      FROM users u

      JOIN ruangan r
        ON r.id = u.ruangan_id

      WHERE u.id = ?
        AND u.role = 'user'

      LIMIT 1
      `,
      [userId]
    );


    if (userRows.length === 0) {
      return res.status(404).json({
        error:
          'Ruangan User tidak ditemukan'
      });
    }


    const ruanganId =
      userRows[0].ruangan_id;

    const ruanganNama =
      userRows[0].ruangan_nama;


    // ========================================================
    // HITUNG STOK RUANGAN
    // ========================================================
    const [rows] = await db.query(
  `
  SELECT
    l.id AS jenis_linen_id,
    l.nama AS jenis_linen_nama,
    l.urutan,

    COALESCE(
      SUM(
        CASE
          WHEN st.status = 'selesai'
          THEN d.jumlah_kotor
          ELSE 0
        END
      ),
      0
    ) AS total_diantar,

    COALESCE(
      SUM(
        CASE
          WHEN st.status = 'selesai'
          THEN d.jumlah_diambil_infeksius
          ELSE 0
        END
      ),
      0
    ) AS total_diambil_infeksius,

    COALESCE(
      SUM(
        CASE
          WHEN st.status = 'selesai'
          THEN d.jumlah_diambil_non_infeksius
          ELSE 0
        END
      ),
      0
    ) AS total_diambil_non_infeksius,

    COALESCE(
      SUM(
        CASE
          WHEN st.status = 'selesai'
          THEN
            d.jumlah_diambil_infeksius +
            d.jumlah_diambil_non_infeksius
          ELSE 0
        END
      ),
      0
    ) AS total_diambil,

    GREATEST(
      COALESCE(
        SUM(
          CASE
            WHEN st.status = 'selesai'
            THEN d.jumlah_kotor
            ELSE 0
          END
        ),
        0
      )
      -
      COALESCE(
        SUM(
          CASE
            WHEN st.status = 'selesai'
            THEN
              d.jumlah_diambil_infeksius +
              d.jumlah_diambil_non_infeksius
            ELSE 0
          END
        ),
        0
      ),
      0
    ) AS stok

  FROM jenis_linen l

  LEFT JOIN serah_terima_detail d
    ON d.jenis_linen_id = l.id

  LEFT JOIN serah_terima st
    ON st.id = d.serah_terima_id
    AND st.ruangan = ?

  GROUP BY
    l.id,
    l.nama,
    l.urutan

  ORDER BY
    l.urutan ASC
  `,
  [ruanganNama]
);

    // ========================================================
    // RESPONSE
    // ========================================================
    res.json({
      ruangan_id: ruanganId,
      ruangan_nama: ruanganNama,
      data: rows
    });


  } catch (err) {

    console.error(
      'GET stok ruangan User:',
      err
    );

    res.status(500).json({
      error:
        'Gagal mengambil stok linen ruangan'
    });

  }

});


module.exports = router;