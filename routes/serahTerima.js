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

  // ==================================
  // ADMIN
  // ==================================
  if (user.role === 'admin') {
    return {
      role: 'admin',
      userId: null,
      ruangan_id: null,
      ruangan_nama: null
    };
  }

  // ==================================
  // LAUNDRY
  // ==================================
  if (user.role === 'laundry') {
    return {
      role: 'laundry',
      userId: user.id,
      ruangan_id: null,
      ruangan_nama: null
    };
  }

  // ==================================
  // USER RUANGAN
  // ==================================
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

      console.error(
        'Error cek ruangan:',
        err
      );

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

    const access =
      await getAccessInfo(req);

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

        COALESCE(
          SUM(d.jumlah_kotor),
          0
        ) AS total_kotor,

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


    // ==================================
    // USER HANYA MELIHAT RUANGAN SENDIRI
    // ==================================
    if (access.role === 'user') {

      query += `
        WHERE st.ruangan = ?
      `;

      params.push(
        access.ruangan_nama
      );
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

      ORDER BY
        st.created_at DESC
    `;


    const [rows] =
      await db.query(
        query,
        params
      );


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

  const {
    id
  } = req.params;


  try {

    const access =
      await getAccessInfo(req);


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


    // ==================================
    // USER HANYA BOLEH MELIHAT RUANGAN SENDIRI
    // ==================================
    if (access.role === 'user') {

      headerQuery += `
        AND ruangan = ?
      `;

      headerParams.push(
        access.ruangan_nama
      );
    }


    const [headerRows] =
      await db.query(
        headerQuery,
        headerParams
      );


    if (headerRows.length === 0) {

      return res.status(404).json({
        error:
          'Transaksi tidak ditemukan atau bukan milik ruangan Anda'
      });

    }


    const [detailRows] =
      await db.query(
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

    const {
      detailId
    } = req.params;


    try {

      const access =
        await getAccessInfo(req);


      if (access.error) {

        return res.status(403).json({
          error: access.error
        });

      }


      // ==================================
      // USER RUANGAN TIDAK BOLEH VERIFIKASI
      // ==================================
      if (
        access.role !== 'admin' &&
        access.role !== 'laundry'
      ) {

        return res.status(403).json({
          error:
            'Hanya Laundry atau Admin yang dapat melakukan verifikasi'
        });

      }


      const [rows] =
        await db.query(
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
          error:
            'Detail transaksi tidak ditemukan'
        });

      }


      const item =
        rows[0];


      const adaPengambilan =
        Number(item.jumlah_diambil_infeksius) > 0 ||
        Number(item.jumlah_diambil_non_infeksius) > 0;


      // ==================================
      // TIDAK ADA YANG DIAMBIL
      // ==================================
      if (!adaPengambilan) {

        return res.status(400).json({
          error:
            'Tidak perlu verifikasi karena tidak ada linen yang diambil'
        });

      }


      await db.query(
        `UPDATE serah_terima_detail
         SET verifikasi_pengambilan = 1
         WHERE id = ?`,
        [detailId]
      );


      res.json({
        message:
          'Pengambilan berhasil diverifikasi'
      });


    } catch (err) {

      console.error(err);

      res.status(500).json({
        error:
          'Gagal melakukan verifikasi'
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

  const {
    id
  } = req.params;


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


  if (
    !Array.isArray(detail) ||
    detail.length === 0
  ) {

    return res.status(400).json({
      error:
        'Detail linen tidak boleh kosong'
    });

  }


  const access =
    await getAccessInfo(req);


  if (access.error) {

    return res.status(403).json({
      error: access.error
    });

  }


  // ==================================
  // USER TIDAK BOLEH EDIT
  // ==================================
  if (
    access.role !== 'admin' &&
    access.role !== 'laundry'
  ) {

    return res.status(403).json({
      error:
        'User ruangan tidak dapat mengedit transaksi'
    });

  }


  if (!ruangan || !ruangan.trim()) {

    return res.status(400).json({
      error:
        'Ruangan wajib diisi'
    });

  }


  const connection =
    await db.getConnection();


  try {

    const [existingRows] =
      await connection.query(
        `SELECT
          id,
          status

         FROM serah_terima

         WHERE id = ?

         LIMIT 1`,
        [id]
      );


    if (existingRows.length === 0) {

      connection.release();

      return res.status(404).json({
        error:
          'Transaksi tidak ditemukan'
      });

    }


    // ==================================
    // CEGAH EDIT TRANSAKSI SELESAI
    // ==================================
    if (
      existingRows[0].status === 'selesai'
    ) {

      connection.release();

      return res.status(400).json({
        error:
          'Transaksi yang sudah selesai tidak dapat diedit'
      });

    }


    await connection.beginTransaction();


    // ======================================================
    // AMBIL DETAIL LAMA UNTUK MENGEMBALIKAN STOK
    // ======================================================
    const [oldDetails] =
      await connection.query(
        `
        SELECT
          jenis_linen_id,
          jumlah_kotor

        FROM serah_terima_detail

        WHERE serah_terima_id = ?

        FOR UPDATE
        `,
        [id]
      );


    // ======================================================
    // KUNCI STOK LINEN LAMA
    // DAN KEMBALIKAN JUMLAH YANG DULU DIKELUARKAN
    // ======================================================
    for (const oldItem of oldDetails) {

      const jumlahLama =
        Number(oldItem.jumlah_kotor) || 0;


      if (jumlahLama <= 0) {
        continue;
      }


      await connection.query(
        `
        UPDATE jenis_linen

        SET jumlah_stok =
          jumlah_stok + ?

        WHERE id = ?
        `,
        [
          jumlahLama,
          oldItem.jenis_linen_id
        ]
      );

    }


    // ======================================================
    // VALIDASI DETAIL BARU
    // ======================================================
    const detailValid = [];


    for (const item of detail) {

      const jenisLinenId =
        Number(item.jenis_linen_id);

      const jumlahKotor =
        Number(item.jumlah_kotor) || 0;

      const jumlahInfeksius =
        Number(item.jumlah_diambil_infeksius) || 0;

      const jumlahNonInfeksius =
        Number(item.jumlah_diambil_non_infeksius) || 0;


      if (
        !Number.isInteger(jenisLinenId) ||
        jenisLinenId <= 0
      ) {

        await connection.rollback();

        return res.status(400).json({
          error:
            'Jenis linen tidak valid'
        });

      }


      if (
        jumlahKotor < 0 ||
        jumlahInfeksius < 0 ||
        jumlahNonInfeksius < 0
      ) {

        await connection.rollback();

        return res.status(400).json({
          error:
            'Jumlah linen tidak boleh negatif'
        });

      }


      if (
        jumlahKotor === 0 &&
        jumlahInfeksius === 0 &&
        jumlahNonInfeksius === 0
      ) {
        continue;
      }


      detailValid.push({
        jenis_linen_id:
          jenisLinenId,

        jumlah_kotor:
          jumlahKotor,

        jumlah_diambil_infeksius:
          jumlahInfeksius,

        jumlah_diambil_non_infeksius:
          jumlahNonInfeksius,

        keterangan:
          item.keterangan || null
      });

    }


    if (detailValid.length === 0) {

      await connection.rollback();

      return res.status(400).json({
        error:
          'Minimal satu jenis linen harus memiliki jumlah'
      });

    }


    // ======================================================
    // CEK STOK UNTUK DETAIL BARU
    // DAN KURANGI STOK
    // ======================================================
    for (const item of detailValid) {

      if (item.jumlah_kotor <= 0) {
        continue;
      }


      const [stokRows] =
        await connection.query(
          `
          SELECT
            id,
            nama,
            jumlah_stok

          FROM jenis_linen

          WHERE id = ?

          LIMIT 1

          FOR UPDATE
          `,
          [item.jenis_linen_id]
        );


      if (stokRows.length === 0) {

        await connection.rollback();

        return res.status(404).json({
          error:
            `Jenis linen dengan ID ${item.jenis_linen_id} tidak ditemukan`
        });

      }


      const stok =
        Number(stokRows[0].jumlah_stok);

      const namaLinen =
        stokRows[0].nama;


      if (
        stok < item.jumlah_kotor
      ) {

        await connection.rollback();

        return res.status(400).json({
          error:
            `Stok ${namaLinen} tidak mencukupi. ` +
            `Stok tersedia: ${stok}, ` +
            `jumlah yang akan diantar: ${item.jumlah_kotor}.`
        });

      }


      await connection.query(
        `
        UPDATE jenis_linen

        SET jumlah_stok =
          jumlah_stok - ?

        WHERE id = ?
        `,
        [
          item.jumlah_kotor,
          item.jenis_linen_id
        ]
      );

    }


    // ======================================================
    // UPDATE HEADER
    // ======================================================
    await connection.query(
      `
      UPDATE serah_terima

      SET
        ruangan = ?,
        tanggal = ?

      WHERE id = ?
      `,
      [
        ruangan.trim(),
        tanggal,
        id
      ]
    );


    // ======================================================
    // HAPUS DETAIL LAMA
    // ======================================================
    await connection.query(
      `
      DELETE FROM serah_terima_detail

      WHERE serah_terima_id = ?
      `,
      [id]
    );


    // ======================================================
    // INSERT DETAIL BARU
    // ======================================================
    for (const item of detailValid) {

      const perluVerifikasi =
        item.jumlah_diambil_infeksius > 0 ||
        item.jumlah_diambil_non_infeksius > 0;


      await connection.query(
        `
        INSERT INTO serah_terima_detail
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

        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id,
          item.jenis_linen_id,
          item.jumlah_kotor,
          item.jumlah_diambil_infeksius,
          item.jumlah_diambil_non_infeksius,
          0,
          perluVerifikasi ? 0 : 0,
          item.keterangan
        ]
      );

    }


    await connection.commit();


    res.json({
      message:
        'Transaksi berhasil diperbarui'
    });


  } catch (err) {

    await connection.rollback();

    console.error(err);

    res.status(500).json({
      error:
        'Gagal memperbarui transaksi'
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

  const {
    id
  } = req.params;


  const access =
    await getAccessInfo(req);


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
      error:
        'User ruangan tidak dapat menghapus transaksi'
    });

  }


  const connection =
    await db.getConnection();


  try {

    // ======================================================
    // AMBIL TRANSAKSI DAN STATUS
    // ======================================================
    const [transactionRows] =
      await connection.query(
        `
        SELECT
          id,
          status

        FROM serah_terima

        WHERE id = ?

        LIMIT 1
        `,
        [id]
      );


    if (transactionRows.length === 0) {

      connection.release();

      return res.status(404).json({
        error:
          'Transaksi tidak ditemukan'
      });

    }


    // ======================================================
    // TIDAK BOLEH HAPUS TRANSAKSI YANG SUDAH SELESAI
    // ======================================================
    if (
      transactionRows[0].status === 'selesai'
    ) {

      connection.release();

      return res.status(400).json({
        error:
          'Transaksi yang sudah selesai tidak dapat dihapus'
      });

    }


    await connection.beginTransaction();


    // ======================================================
    // AMBIL DETAIL LAMA
    // ======================================================
    const [detailRows] =
      await connection.query(
        `
        SELECT
          jenis_linen_id,
          jumlah_kotor

        FROM serah_terima_detail

        WHERE serah_terima_id = ?

        FOR UPDATE
        `,
        [id]
      );


    // ======================================================
    // KEMBALIKAN STOK
    // Karena transaksi dihapus,
    // linen yang sebelumnya diantar kembali dianggap
    // tersedia lagi di Laundry.
    // ======================================================
    for (const item of detailRows) {

      const jumlahKotor =
        Number(item.jumlah_kotor) || 0;


      if (jumlahKotor <= 0) {
        continue;
      }


      await connection.query(
        `
        UPDATE jenis_linen

        SET jumlah_stok =
          jumlah_stok + ?

        WHERE id = ?
        `,
        [
          jumlahKotor,
          item.jenis_linen_id
        ]
      );

    }


    // ======================================================
    // HAPUS DETAIL
    // ======================================================
    await connection.query(
      `
      DELETE FROM serah_terima_detail

      WHERE serah_terima_id = ?
      `,
      [id]
    );


    // ======================================================
    // HAPUS HEADER
    // ======================================================
    const [result] =
      await connection.query(
        `
        DELETE FROM serah_terima

        WHERE id = ?
        `,
        [id]
      );


    if (result.affectedRows === 0) {

      await connection.rollback();

      return res.status(404).json({
        error:
          'Transaksi tidak ditemukan'
      });

    }


    await connection.commit();


    res.json({
      message:
        'Transaksi berhasil dihapus dan stok Laundry dikembalikan'
    });


  } catch (err) {

    await connection.rollback();

    console.error(err);

    res.status(500).json({
      error:
        'Gagal menghapus transaksi'
    });


  } finally {

    connection.release();

  }

});


// ============================================================
// POST TRANSAKSI BARU
// ============================================================
// ADMIN   : boleh
// LAUNDRY : boleh
// USER    : TIDAK BOLEH
//
// Saat transaksi dibuat:
// - jumlah_kotor (DIANTAR) mengurangi stok Laundry
// - jumlah_diambil_infeksius tidak menambah stok
// - jumlah_diambil_non_infeksius tidak menambah stok
//
// Pengurangan stok dan pembuatan transaksi dilakukan
// dalam SATU transaksi MySQL.
// ============================================================
router.post('/', async (req, res) => {

  const {
    ruangan,
    tanggal,
    detail
  } = req.body;


  // ==========================================================
  // VALIDASI DASAR
  // ==========================================================
  if (!ruangan || !ruangan.trim()) {

    return res.status(400).json({
      error:
        'Ruangan wajib diisi'
    });

  }


  if (!tanggal) {

    return res.status(400).json({
      error:
        'Tanggal wajib diisi'
    });

  }


  if (
    !Array.isArray(detail) ||
    detail.length === 0
  ) {

    return res.status(400).json({
      error:
        'Detail linen tidak boleh kosong'
    });

  }


  try {

    // ========================================================
    // CEK ROLE
    // ========================================================
    const access =
      await getAccessInfo(req);


    if (access.error) {

      return res.status(403).json({
        error:
          access.error
      });

    }


    // User ruangan tidak boleh membuat transaksi
    if (
      access.role !== 'admin' &&
      access.role !== 'laundry'
    ) {

      return res.status(403).json({
        error:
          'Hanya Laundry atau Admin yang dapat membuat transaksi'
      });

    }


    // ========================================================
    // AMBIL CONNECTION KHUSUS
    // ========================================================
    const connection =
      await db.getConnection();


    try {

      // ======================================================
      // MULAI TRANSAKSI DATABASE
      // ======================================================
      await connection.beginTransaction();


      // ======================================================
      // VALIDASI DAN KUMPULKAN DETAIL VALID
      // ======================================================
      const detailValid = [];


      for (const item of detail) {

        const jenisLinenId =
          Number(item.jenis_linen_id);

        const jumlahKotor =
          Number(item.jumlah_kotor) || 0;

        const jumlahInfeksius =
          Number(item.jumlah_diambil_infeksius) || 0;

        const jumlahNonInfeksius =
          Number(item.jumlah_diambil_non_infeksius) || 0;


        // ================================================
        // ID JENIS LINEN WAJIB VALID
        // ================================================
        if (
          !Number.isInteger(jenisLinenId) ||
          jenisLinenId <= 0
        ) {

          await connection.rollback();

          return res.status(400).json({
            error:
              'Jenis linen tidak valid'
          });

        }


        // ================================================
        // JUMLAH TIDAK BOLEH NEGATIF
        // ================================================
        if (
          jumlahKotor < 0 ||
          jumlahInfeksius < 0 ||
          jumlahNonInfeksius < 0
        ) {

          await connection.rollback();

          return res.status(400).json({
            error:
              'Jumlah linen tidak boleh negatif'
          });

        }


        // ================================================
        // SEMUA KOSONG
        // ================================================
        if (
          jumlahKotor === 0 &&
          jumlahInfeksius === 0 &&
          jumlahNonInfeksius === 0
        ) {

          continue;

        }


        detailValid.push({

          jenis_linen_id:
            jenisLinenId,

          jumlah_kotor:
            jumlahKotor,

          jumlah_diambil_infeksius:
            jumlahInfeksius,

          jumlah_diambil_non_infeksius:
            jumlahNonInfeksius,

          keterangan:
            item.keterangan || null

        });

      }


      // ======================================================
      // HARUS ADA MINIMAL SATU DETAIL
      // ======================================================
      if (detailValid.length === 0) {

        await connection.rollback();

        return res.status(400).json({
          error:
            'Minimal satu jenis linen harus memiliki jumlah'
        });

      }


      // ======================================================
      // CEK STOK DAN KURANGI STOK
      // ======================================================
      for (
        const item of detailValid
      ) {

        // Kalau tidak ada linen yang diantar,
        // tidak perlu cek/kurangi stok.
        if (
          item.jumlah_kotor <= 0
        ) {
          continue;
        }


        // ================================================
        // KUNCI BARIS STOK
        // ================================================
        const [stokRows] =
          await connection.query(
            `
            SELECT
              id,
              nama,
              jumlah_stok

            FROM jenis_linen

            WHERE id = ?

            LIMIT 1

            FOR UPDATE
            `,
            [
              item.jenis_linen_id
            ]
          );


        // ================================================
        // JENIS LINEN TIDAK DITEMUKAN
        // ================================================
        if (
          stokRows.length === 0
        ) {

          await connection.rollback();

          return res.status(404).json({
            error:
              `Jenis linen dengan ID ${item.jenis_linen_id} tidak ditemukan`
          });

        }


        const stok =
          Number(
            stokRows[0].jumlah_stok
          );

        const namaLinen =
          stokRows[0].nama;


        // ================================================
        // CEK STOK CUKUP
        // ================================================
        if (
          stok < item.jumlah_kotor
        ) {

          await connection.rollback();

          return res.status(400).json({

            error:
              `Stok ${namaLinen} tidak mencukupi. ` +
              `Stok tersedia: ${stok}, ` +
              `jumlah yang akan diantar: ${item.jumlah_kotor}.`

          });

        }


        // ================================================
        // KURANGI STOK
        // ================================================
        await connection.query(
          `
          UPDATE jenis_linen

          SET jumlah_stok =
            jumlah_stok - ?

          WHERE id = ?
          `,
          [
            item.jumlah_kotor,
            item.jenis_linen_id
          ]
        );

      }


      // ======================================================
      // INSERT HEADER
      // ======================================================
      const [headerResult] =
        await connection.query(
          `
          INSERT INTO serah_terima
          (
            ruangan,
            tanggal,
            status,
            dibuat_oleh_user_id
          )

          VALUES (
            ?,
            ?,
            'menunggu_konfirmasi',
            ?
          )
          `,
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
      for (
        const item of detailValid
      ) {

        const perluVerifikasi =
          item.jumlah_diambil_infeksius > 0 ||
          item.jumlah_diambil_non_infeksius > 0;


        await connection.query(
          `
          INSERT INTO serah_terima_detail
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

          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `,
          [
            serahTerimaId,
            item.jenis_linen_id,
            item.jumlah_kotor,
            item.jumlah_diambil_infeksius,
            item.jumlah_diambil_non_infeksius,
            0,
            perluVerifikasi ? 0 : 0,
            item.keterangan
          ]
        );

      }


      // ======================================================
      // SEMUA BERHASIL
      // ======================================================
      await connection.commit();


      return res.status(201).json({

        message:
          'Data serah terima berhasil disimpan dan stok Laundry berhasil diperbarui',

        id:
          serahTerimaId,

        ruangan:
          ruangan.trim(),

        status:
          'menunggu_konfirmasi'

      });


    } catch (err) {

      // ======================================================
      // GAGAL → SEMUA PERUBAHAN DIBATALKAN
      // ======================================================
      await connection.rollback();

      console.error(
        'Error transaksi + stok:',
        err
      );


      return res.status(500).json({
        error:
          'Gagal menyimpan data serah terima dan memperbarui stok'
      });


    } finally {

      connection.release();

    }


  } catch (err) {

    console.error(
      'Error memproses transaksi:',
      err
    );


    return res.status(500).json({
      error:
        'Gagal memproses transaksi'
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

  const {
    id
  } = req.params;


  const {
    nama_penerima,
    tanda_tangan
  } = req.body;


  if (
    !nama_penerima ||
    !nama_penerima.trim()
  ) {

    return res.status(400).json({
      error:
        'Nama penerima wajib diisi'
    });

  }


  if (!tanda_tangan) {

    return res.status(400).json({
      error:
        'Tanda tangan wajib diisi'
    });

  }


  try {

    const access =
      await getAccessInfo(req);


    if (access.error) {

      return res.status(403).json({
        error:
          access.error
      });

    }


    // ==================================
    // HANYA USER RUANGAN
    // ==================================
    if (
      access.role !== 'user'
    ) {

      return res.status(403).json({
        error:
          'Hanya user ruangan yang dapat melakukan konfirmasi'
      });

    }


    const [rows] =
      await db.query(
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


    if (
      rows.length === 0
    ) {

      return res.status(404).json({
        error:
          'Transaksi tidak ditemukan atau bukan milik ruangan Anda'
      });

    }


    const transaksi =
      rows[0];


    // ==================================
    // SUDAH SELESAI
    // ==================================
    if (
      transaksi.status === 'selesai'
    ) {

      return res.status(400).json({
        error:
          'Transaksi ini sudah dikonfirmasi'
      });

    }


    await db.query(
      `
      UPDATE serah_terima

      SET
        status = 'selesai',
        nama_penerima = ?,
        tanda_tangan = ?,
        diterima_oleh_user_id = ?,
        diterima_at = NOW()

      WHERE id = ?
      `,
      [
        nama_penerima.trim(),
        tanda_tangan,
        access.userId,
        id
      ]
    );


    res.json({
      message:
        'Penerimaan berhasil dikonfirmasi',

      status:
        'selesai'
    });


  } catch (err) {

    console.error(err);

    res.status(500).json({
      error:
        'Gagal melakukan konfirmasi penerimaan'
    });

  }

});


module.exports = router;