const express = require('express');
const router = express.Router();
const db = require('../config/db');


// ==========================================================
// MIDDLEWARE
// Admin dan Laundry boleh melihat stok Laundry.
// User ruangan tidak boleh.
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
// GET STOK LINEN LAUNDRY
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
      'GET stok Laundry:',
      err
    );

    res.status(500).json({
      error: 'Gagal mengambil stok linen Laundry'
    });

  }

});


module.exports = router;