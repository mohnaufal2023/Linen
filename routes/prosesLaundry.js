const express = require('express');
const router = express.Router();
const db = require('../config/db');
const ExcelJS = require('exceljs');


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

    const [rows] = await db.query(`
      SELECT
        p.id,
        p.serah_terima_detail_id,
        p.jenis_linen_id,

        l.nama AS jenis_linen_nama,

        p.jumlah_infeksius,
        p.jumlah_non_infeksius,
        p.jumlah_total,

        p.jumlah_verifikasi_infeksius,
        p.jumlah_verifikasi_non_infeksius,

        p.status,

        p.jumlah_layak,
        p.jumlah_rusak,
        p.keterangan_rusak,

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
          WHEN p.status = 'menunggu_verifikasi' THEN 3
          WHEN p.status = 'selesai' THEN 4
          ELSE 5
        END,
        p.created_at DESC
    `);

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
// EXPORT EXCEL RIWAYAT PROSES LAUNDRY
// Hanya mengambil data dengan status selesai
// ==========================================================
router.get('/export/excel', async (req, res) => {
  try {
    const { bulan, tahun, ruangan } = req.query;

    // Validasi bulan dan tahun
    const month = Number(bulan);
    const year = Number(tahun);

    if (
      !Number.isInteger(month) || month < 1 || month > 12 ||
      !Number.isInteger(year) || year < 2000 || year > 9999
    ) {
      return res.status(400).json({
        error: 'Bulan atau tahun tidak valid'
      });
    }

    // Menentukan rentang tanggal
    const pad = (value) => String(value).padStart(2, '0');

    const tanggalMulai = `${year}-${pad(month)}-01 00:00:00`;

    const nextMonth = new Date(year, month, 1);
    const tanggalAkhir =
      `${nextMonth.getFullYear()}-${pad(nextMonth.getMonth() + 1)}-01 00:00:00`;

    // Query data yang sudah selesai
    let sql = `
      SELECT
        p.id,
        p.created_at,
        p.selesai_at,
        p.jumlah_infeksius,
        p.jumlah_non_infeksius,
        p.jumlah_total,
        p.jumlah_layak,
        p.jumlah_rusak,
        p.status,
        l.nama AS jenis_linen_nama,
        st.ruangan

      FROM proses_laundry p

      JOIN jenis_linen l
        ON l.id = p.jenis_linen_id

      JOIN serah_terima_detail d
        ON d.id = p.serah_terima_detail_id

      JOIN serah_terima st
        ON st.id = d.serah_terima_id

      WHERE p.status = 'selesai'
        AND p.selesai_at >= ?
        AND p.selesai_at < ?
    `;

    const params = [tanggalMulai, tanggalAkhir];

    if (ruangan && ruangan !== 'semua') {
      sql += ` AND st.ruangan = ?`;
      params.push(ruangan);
    }

    sql += ` ORDER BY p.selesai_at ASC`;

    const [rows] = await db.query(sql, params);

    // Membuat workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Riwayat Proses Laundry');

    worksheet.columns = [
      { header: 'No', key: 'no', width: 8 },
      { header: 'Tanggal Masuk Proses', key: 'created_at', width: 22 },
      { header: 'Ruangan', key: 'ruangan', width: 20 },
      { header: 'Jenis Linen', key: 'jenis_linen_nama', width: 25 },
      { header: 'Infeksius', key: 'infeksius', width: 15 },
      { header: 'Non-Infeksius', key: 'non_infeksius', width: 18 },
      { header: 'Jumlah Total', key: 'jumlah_total', width: 15 },
      { header: 'Jumlah Layak', key: 'jumlah_layak', width: 15 },
      { header: 'Jumlah Rusak', key: 'jumlah_rusak', width: 15 },
      { header: 'Status', key: 'status', width: 18 },
      { header: 'Tanggal Selesai', key: 'selesai_at', width: 22 }
    ];

    // Judul laporan
    worksheet.insertRow(1, [
      `LAPORAN RIWAYAT PROSES LAUNDRY`
    ]);

    worksheet.mergeCells('A1:K1');
    worksheet.getCell('A1').font = {
      bold: true,
      size: 16
    };
    worksheet.getCell('A1').alignment = {
      horizontal: 'center'
    };

    worksheet.insertRow(2, [
      `Periode: ${pad(month)}/${year} | Ruangan: ${
        ruangan && ruangan !== 'semua' ? ruangan : 'Semua Ruangan'
      }`
    ]);

    worksheet.mergeCells('A2:K2');

    // Header tabel
    const headerRow = worksheet.getRow(4);
    headerRow.values = worksheet.columns.map(column => column.header);
    headerRow.font = { bold: true };
    headerRow.alignment = { horizontal: 'center' };

    headerRow.eachCell(cell => {
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' }
      };
    });

    // Isi laporan
    rows.forEach((item, index) => {
      const row = worksheet.addRow({
        no: index + 1,
        created_at: item.created_at,
        ruangan: item.ruangan,
        jenis_linen_nama: item.jenis_linen_nama,
        infeksius: item.jumlah_infeksius,
        non_infeksius: item.jumlah_non_infeksius,
        jumlah_total: item.jumlah_total,
        jumlah_layak: item.jumlah_layak,
        jumlah_rusak: item.jumlah_rusak,
        status: item.status,
        selesai_at: item.selesai_at
      });

      row.getCell('created_at').numFmt = 'dd/mm/yyyy hh:mm';
      row.getCell('selesai_at').numFmt = 'dd/mm/yyyy hh:mm';

      row.eachCell(cell => {
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
    });

    if (rows.length === 0) {
      worksheet.getCell('A5').value = 'Tidak ada data proses laundry yang selesai pada periode ini.';
      worksheet.mergeCells('A5:K5');
    }

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    res.setHeader(
      'Content-Disposition',
      `attachment; filename=laporan-proses-laundry-${year}-${pad(month)}.xlsx`
    );

    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('EXPORT EXCEL PROSES LAUNDRY:', err);

    res.status(500).json({
      error: 'Gagal membuat laporan Excel'
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

    const [rows] = await db.query(`
      SELECT
        p.id,
        p.serah_terima_detail_id,
        p.jenis_linen_id,

        l.nama AS jenis_linen_nama,

        p.jumlah_infeksius,
        p.jumlah_non_infeksius,
        p.jumlah_total,

        p.jumlah_verifikasi_infeksius,
        p.jumlah_verifikasi_non_infeksius,

        p.status,

        p.jumlah_layak,
        p.jumlah_rusak,
        p.keterangan_rusak,

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
    `, [id]);

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

    const [rows] = await db.query(`
      SELECT
        id,
        status

      FROM proses_laundry

      WHERE id = ?

      LIMIT 1
    `, [id]);


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


    await db.query(`
      UPDATE proses_laundry

      SET status = 'sedang_dicuci'

      WHERE id = ?
    `, [id]);


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
// sedang_dicuci -> menunggu_verifikasi
//
// BELUM mengubah stok.
// BELUM menentukan layak/rusak.
// ==========================================================
router.put('/:id/selesai-cuci', async (req, res) => {

  const {
    id
  } = req.params;


  try {

    const [rows] = await db.query(`
      SELECT
        id,
        status

      FROM proses_laundry

      WHERE id = ?

      LIMIT 1
    `, [id]);


    if (rows.length === 0) {

      return res.status(404).json({
        error: 'Data proses Laundry tidak ditemukan'
      });

    }


    if (
      rows[0].status !== 'sedang_dicuci'
    ) {

      return res.status(400).json({
        error:
          'Proses harus berstatus Sedang Dicuci'
      });

    }


    await db.query(`
      UPDATE proses_laundry

      SET status = 'menunggu_verifikasi'

      WHERE id = ?
    `, [id]);


    res.json({
      message:
        'Pencucian selesai. Menunggu verifikasi jumlah linen.',

      status:
        'menunggu_verifikasi'
    });


  } catch (err) {

    console.error(
      'Selesai cuci:',
      err
    );

    res.status(500).json({
      error:
        'Gagal menyelesaikan tahap pencucian'
    });

  }

});


// ==========================================================
// VERIFIKASI JUMLAH LINEN
// ==========================================================
//
// Data awal:
// - jumlah_infeksius
// - jumlah_non_infeksius
//
// Data hasil verifikasi:
// - jumlah_verifikasi_infeksius
// - jumlah_verifikasi_non_infeksius
//
// Jika berbeda:
// - sistem memberikan warning
// - Laundry dapat konfirmasi untuk melanjutkan
//
// Setelah verifikasi:
// status tetap menunggu_verifikasi
// karena tahap berikutnya adalah Layak / Rusak.
// ==========================================================
router.put('/:id/verifikasi', async (req, res) => {

  const {
    id
  } = req.params;


  const {
    jumlah_verifikasi_infeksius,
    jumlah_verifikasi_non_infeksius,
    konfirmasi_mismatch
  } = req.body;


  const verifikasiInfeksius =
    Number(jumlah_verifikasi_infeksius);

  const verifikasiNonInfeksius =
    Number(jumlah_verifikasi_non_infeksius);


  // ========================================================
  // VALIDASI ANGKA
  // ========================================================

  if (
    !Number.isInteger(verifikasiInfeksius) ||
    !Number.isInteger(verifikasiNonInfeksius)
  ) {

    return res.status(400).json({
      error:
        'Jumlah verifikasi harus berupa angka bulat'
    });

  }


  if (
    verifikasiInfeksius < 0 ||
    verifikasiNonInfeksius < 0
  ) {

    return res.status(400).json({
      error:
        'Jumlah verifikasi tidak boleh negatif'
    });

  }


  const connection =
    await db.getConnection();


  try {

    await connection.beginTransaction();


    // ======================================================
    // AMBIL DATA PROSES
    // ======================================================

    const [rows] =
      await connection.query(`
        SELECT
          p.id,
          p.serah_terima_detail_id,

          p.jumlah_infeksius,
          p.jumlah_non_infeksius,

          p.jumlah_total,

          p.status

        FROM proses_laundry p

        WHERE p.id = ?

        LIMIT 1

        FOR UPDATE
      `, [id]);


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
    // HARUS MENUNGGU VERIFIKASI
    // ======================================================

    if (
      proses.status !== 'menunggu_verifikasi'
    ) {

      await connection.rollback();

      return res.status(400).json({
        error:
          'Proses belum berada pada tahap Verifikasi'
      });

    }


    // ======================================================
    // DATA AWAL
    // ======================================================

    const awalInfeksius =
      Number(proses.jumlah_infeksius) || 0;

    const awalNonInfeksius =
      Number(proses.jumlah_non_infeksius) || 0;

    const awalTotal =
      awalInfeksius +
      awalNonInfeksius;


    // ======================================================
    // HASIL VERIFIKASI
    // ======================================================

    const hasilTotal =
      verifikasiInfeksius +
      verifikasiNonInfeksius;


    // ======================================================
    // CEK MISMATCH
    // ======================================================

    const mismatch =
      awalInfeksius !== verifikasiInfeksius ||
      awalNonInfeksius !== verifikasiNonInfeksius;


    // ======================================================
    // JIKA MISMATCH DAN BELUM DIKONFIRMASI
    // ======================================================

    if (
      mismatch &&
      konfirmasi_mismatch !== true
    ) {

      await connection.rollback();

      return res.status(409).json({

        warning: true,

        error:
          'Jumlah hasil verifikasi berbeda dengan data awal.',

        data_awal: {
          infeksius:
            awalInfeksius,

          non_infeksius:
            awalNonInfeksius,

          total:
            awalTotal
        },

        hasil_verifikasi: {
          infeksius:
            verifikasiInfeksius,

          non_infeksius:
            verifikasiNonInfeksius,

          total:
            hasilTotal
        }

      });

    }


    // ======================================================
    // SIMPAN HASIL VERIFIKASI
    // ======================================================

    await connection.query(`
      UPDATE proses_laundry

      SET
        jumlah_verifikasi_infeksius = ?,
        jumlah_verifikasi_non_infeksius = ?

      WHERE id = ?
    `, [
      verifikasiInfeksius,
      verifikasiNonInfeksius,
      id
    ]);


    // ======================================================
    // SIMPAN JUGA KE DETAIL SERAH TERIMA
    // ======================================================

    await connection.query(`
      UPDATE serah_terima_detail

      SET
        jumlah_verifikasi_infeksius = ?,
        jumlah_verifikasi_non_infeksius = ?

      WHERE id = ?
    `, [
      verifikasiInfeksius,
      verifikasiNonInfeksius,
      proses.serah_terima_detail_id
    ]);


    // ======================================================
    // COMMIT
    // ======================================================

    await connection.commit();


    res.json({

      message:
        mismatch
          ? 'Verifikasi berhasil disimpan setelah konfirmasi perbedaan jumlah.'
          : 'Verifikasi jumlah linen berhasil disimpan.',

      status:
        'menunggu_verifikasi',

      mismatch,

      data_awal: {
        infeksius:
          awalInfeksius,

        non_infeksius:
          awalNonInfeksius,

        total:
          awalTotal
      },

      hasil_verifikasi: {
        infeksius:
          verifikasiInfeksius,

        non_infeksius:
          verifikasiNonInfeksius,

        total:
          hasilTotal
      }

    });


  } catch (err) {

    await connection.rollback();

    console.error(
      'Verifikasi proses laundry:',
      err
    );

    res.status(500).json({
      error:
        'Gagal menyimpan verifikasi proses Laundry'
    });


  } finally {

    connection.release();

  }

});


// ==========================================================
// SELESAIKAN PROSES LAUNDRY
// ==========================================================
//
// Tahap:
// menunggu_verifikasi -> selesai
//
// Input:
// - jumlah_layak
// - jumlah_rusak
// - keterangan_rusak
//
// PENTING:
// Total yang digunakan adalah HASIL VERIFIKASI,
// bukan lagi jumlah awal dari ruangan.
//
// Contoh:
//
// Awal:
// Infeksius 5
// Non-infeksius 3
// Total 8
//
// Verifikasi:
// Infeksius 4
// Non-infeksius 3
// Total 7
//
// Maka:
// Layak + Rusak harus = 7
//
// Setelah selesai:
// - stok bersih += layak
// - stok rusak += rusak
// - status = selesai
// ==========================================================
router.put('/:id/selesai', async (req, res) => {

  const {
    id
  } = req.params;


  const {
    jumlah_layak,
    jumlah_rusak,
    keterangan_rusak
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


  // ========================================================
  // VALIDASI KETERANGAN RUSAK
  // ========================================================

  const keteranganRusak =
    typeof keterangan_rusak === 'string'
      ? keterangan_rusak.trim()
      : '';


  if (
    rusak > 0 &&
    !keteranganRusak
  ) {

    return res.status(400).json({
      error:
        'Keterangan kerusakan wajib diisi jika terdapat linen rusak'
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
      await connection.query(`
        SELECT
          id,
          serah_terima_detail_id,
          jenis_linen_id,

          jumlah_infeksius,
          jumlah_non_infeksius,

          jumlah_total,

          jumlah_verifikasi_infeksius,
          jumlah_verifikasi_non_infeksius,

          jumlah_layak,
          jumlah_rusak,

          status

        FROM proses_laundry

        WHERE id = ?

        LIMIT 1

        FOR UPDATE
      `, [id]);


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
    // HARUS SUDAH SELESAI VERIFIKASI
    // ======================================================

    if (
      proses.status !== 'menunggu_verifikasi'
    ) {

      await connection.rollback();

      return res.status(400).json({
        error:
          'Proses harus berada pada tahap Menunggu Verifikasi'
      });

    }


    // ======================================================
    // AMBIL HASIL VERIFIKASI
    // ======================================================

    const verifikasiInfeksius =
      Number(
        proses.jumlah_verifikasi_infeksius
      ) || 0;


    const verifikasiNonInfeksius =
      Number(
        proses.jumlah_verifikasi_non_infeksius
      ) || 0;


    const jumlahTotalVerifikasi =
      verifikasiInfeksius +
      verifikasiNonInfeksius;


    // ======================================================
    // PASTIKAN VERIFIKASI SUDAH DIISI
    // ======================================================
    //
    // Karena default database adalah 0, kita tidak bisa hanya
    // mengandalkan total > 0.
    //
    // Kita cek detail transaksi untuk memastikan proses
    // memang memiliki linen yang harus diverifikasi.
    // ======================================================

    const jumlahAwal =
      (
        Number(proses.jumlah_infeksius) || 0
      ) +
      (
        Number(proses.jumlah_non_infeksius) || 0
      );


    if (
      jumlahAwal > 0 &&
      jumlahTotalVerifikasi === 0
    ) {

      await connection.rollback();

      return res.status(400).json({
        error:
          'Verifikasi jumlah linen belum dilakukan'
      });

    }


    // ======================================================
    // VALIDASI LAYAK + RUSAK
    // MENGGUNAKAN TOTAL HASIL VERIFIKASI
    // ======================================================

    if (
      layak + rusak !== jumlahTotalVerifikasi
    ) {

      await connection.rollback();

      return res.status(400).json({
        error:
          `Jumlah layak (${layak}) + ` +
          `jumlah rusak (${rusak}) harus sama dengan ` +
          `jumlah hasil verifikasi (${jumlahTotalVerifikasi}).`
      });

    }


    // ======================================================
    // UPDATE STOK BERSIH
    // ======================================================

    if (layak > 0) {

      await connection.query(`
        UPDATE jenis_linen

        SET
          jumlah_stok =
            jumlah_stok + ?

        WHERE id = ?
      `, [
        layak,
        proses.jenis_linen_id
      ]);

    }


    // ======================================================
    // UPDATE STOK RUSAK
    // ======================================================

    if (rusak > 0) {

      await connection.query(`
        UPDATE jenis_linen

        SET
          jumlah_rusak =
            jumlah_rusak + ?

        WHERE id = ?
      `, [
        rusak,
        proses.jenis_linen_id
      ]);

    }


    // ======================================================
    // UPDATE PROSES LAUNDRY
    // ======================================================

    await connection.query(`
      UPDATE proses_laundry

      SET
        jumlah_layak = ?,
        jumlah_rusak = ?,
        keterangan_rusak = ?,

        status = 'selesai',

        selesai_at = NOW()

      WHERE id = ?
    `, [
      layak,
      rusak,
      keteranganRusak || null,
      id
    ]);


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
        jumlahTotalVerifikasi,

      jumlah_verifikasi_infeksius:
        verifikasiInfeksius,

      jumlah_verifikasi_non_infeksius:
        verifikasiNonInfeksius,

      jumlah_layak:
        layak,

      jumlah_rusak:
        rusak,

      keterangan_rusak:
        keteranganRusak || null

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