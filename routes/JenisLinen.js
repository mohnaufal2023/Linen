const express = require('express');
const router = express.Router();
const db = require('../config/db');

// GET semua jenis linen, diurutkan sesuai kolom "urutan"
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, nama, urutan FROM jenis_linen ORDER BY urutan ASC'
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Gagal mengambil data jenis linen' });
  }
});

module.exports = router;