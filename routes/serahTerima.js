const express = require("express");
const router = express.Router();
const db = require("../config/db");

// ============================================================
// HELPER AKSES USER
// ============================================================

async function getAccessInfo(req) {
  const user = req.session?.user;

  if (!user) {
    return {
      error: "Silakan login terlebih dahulu",
    };
  }

  // ==========================================================
  // ADMIN
  // ==========================================================

  if (user.role === "admin") {
    return {
      role: "admin",
      userId: user.id || null,
      ruangan_id: null,
      ruangan_nama: null,
    };
  }

  // ==========================================================
  // LAUNDRY
  // ==========================================================

  if (user.role === "laundry") {
    return {
      role: "laundry",
      userId: user.id,
      ruangan_id: null,
      ruangan_nama: null,
    };
  }

  // ==========================================================
  // USER RUANGAN
  // ==========================================================

  if (user.role === "user") {
    if (!user.ruangan_id) {
      return {
        error: "Akun user belum terhubung dengan ruangan",
      };
    }

    try {
      const [rows] = await db.query(
        `
          SELECT
            id,
            nama
          FROM ruangan
          WHERE id = ?
          LIMIT 1
          `,
        [user.ruangan_id],
      );

      if (rows.length === 0) {
        return {
          error: "Ruangan akun user tidak ditemukan",
        };
      }

      return {
        role: "user",
        userId: user.id,
        ruangan_id: rows[0].id,
        ruangan_nama: rows[0].nama,
      };
    } catch (err) {
      console.error("Error cek ruangan:", err);

      return {
        error: "Gagal memeriksa ruangan user",
      };
    }
  }

  return {
    error: "Role akun tidak dikenali",
  };
}

// ============================================================
// HELPER: CEK TRANSAKSI SUDAH SELESAI
// ============================================================

async function updateStatusIfComplete(connection, id) {
  const [rows] = await connection.query(
    `
      SELECT
        id,
        jenis_transaksi,
        status,
        tanda_tangan,
        tanda_tangan_pengantar,
        tanda_tangan_penyerah,
        tanda_tangan_penerima_laundry
      FROM serah_terima
      WHERE id = ?
      LIMIT 1
      FOR UPDATE
      `,
    [id],
  );

  if (rows.length === 0) {
    return null;
  }

  const transaksi = rows[0];

  // ==========================================================
  // PENGANTARAN
  // ==========================================================

  if (transaksi.jenis_transaksi === "pengantaran") {
    const penerimaSudahTtd = !!transaksi.tanda_tangan;

    const pengantarSudahTtd = !!transaksi.tanda_tangan_pengantar;

    if (penerimaSudahTtd && pengantarSudahTtd) {
      await connection.query(
        `
        UPDATE serah_terima
        SET status = 'selesai'
        WHERE id = ?
        `,
        [id],
      );

      transaksi.status = "selesai";
    }
  }

  return transaksi;
}

// ============================================================
// GET SEMUA TRANSAKSI
// ============================================================
// ADMIN   : semua transaksi
// LAUNDRY : semua transaksi
// USER    : hanya transaksi ruangan sendiri
// ============================================================

router.get("/", async (req, res) => {
  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error,
      });
    }

    let query = `
      SELECT

        st.id,
        st.ruangan,
        st.tanggal,
        st.jenis_transaksi,
        st.status,
        st.created_at,

        st.dibuat_oleh_user_id,

        st.nama_penerima,
        st.tanda_tangan,
        st.diterima_oleh_user_id,
        st.diterima_at,

        st.nama_pengantar,
        st.tanda_tangan_pengantar,
        st.diantar_oleh_user_id,
        st.diantar_at,

        st.nama_penyerah,
        st.tanda_tangan_penyerah,
        st.diserahkan_oleh_user_id,
        st.diserahkan_at,

        st.tanda_tangan_penerima_laundry,
        st.diterima_laundry_oleh_user_id,
        st.diterima_laundry_at,

        COALESCE(
          SUM(d.jumlah_kotor),
          0
        ) AS total_diantar,

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
        ) AS total_pengambilan

      FROM serah_terima st

      LEFT JOIN serah_terima_detail d
        ON d.serah_terima_id = st.id
    `;

    const params = [];

    // ========================================================
    // USER HANYA MELIHAT RUANGANNYA
    // ========================================================

    if (access.role === "user") {
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
        st.jenis_transaksi,
        st.status,
        st.created_at,

        st.dibuat_oleh_user_id,

        st.nama_penerima,
        st.tanda_tangan,
        st.diterima_oleh_user_id,
        st.diterima_at,

        st.nama_pengantar,
        st.tanda_tangan_pengantar,
        st.diantar_oleh_user_id,
        st.diantar_at,

        st.nama_penyerah,
        st.tanda_tangan_penyerah,
        st.diserahkan_oleh_user_id,
        st.diserahkan_at,

        st.tanda_tangan_penerima_laundry,
        st.diterima_laundry_oleh_user_id,
        st.diterima_laundry_at

      ORDER BY
        st.created_at DESC
    `;

    const [rows] = await db.query(query, params);

    return res.json(rows);
  } catch (err) {
    console.error("Error GET serah-terima:", err);

    return res.status(500).json({
      error: "Gagal mengambil data transaksi",
    });
  }
});

// ============================================================
// GET DETAIL TRANSAKSI
// ============================================================

router.get("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error,
      });
    }

    let headerQuery = `
      SELECT

        id,
        ruangan,
        tanggal,
        jenis_transaksi,
        status,
        created_at,

        dibuat_oleh_user_id,

        nama_penerima,
        tanda_tangan,
        diterima_oleh_user_id,
        diterima_at,

        nama_pengantar,
        tanda_tangan_pengantar,
        diantar_oleh_user_id,
        diantar_at,

        nama_penyerah,
        tanda_tangan_penyerah,
        diserahkan_oleh_user_id,
        diserahkan_at,

        tanda_tangan_penerima_laundry,
        diterima_laundry_oleh_user_id,
        diterima_laundry_at

      FROM serah_terima

      WHERE id = ?
    `;

    const headerParams = [id];

    // ========================================================
    // USER HANYA BOLEH MELIHAT RUANGANNYA
    // ========================================================

    if (access.role === "user") {
      headerQuery += `
        AND ruangan = ?
      `;

      headerParams.push(access.ruangan_nama);
    }

    const [headerRows] = await db.query(headerQuery, headerParams);

    if (headerRows.length === 0) {
      return res.status(404).json({
        error: "Transaksi tidak ditemukan atau bukan milik ruangan Anda",
      });
    }

    const [detailRows] = await db.query(
      `
        SELECT

          d.id,
          d.serah_terima_id,
          d.jenis_linen_id,

          l.nama AS jenis_linen_nama,

          d.jumlah_kotor,

          d.jumlah_bersih,

          d.jumlah_diambil_infeksius,
          d.jumlah_diambil_non_infeksius,

          d.jumlah_verifikasi_infeksius,
          d.jumlah_verifikasi_non_infeksius,

          d.verifikasi_infeksius,
          d.verifikasi_pengambilan,

          d.keterangan,
          d.keterangan_rusak

        FROM serah_terima_detail d

        JOIN jenis_linen l
          ON l.id = d.jenis_linen_id

        WHERE d.serah_terima_id = ?

        ORDER BY
          l.urutan ASC,
          d.id ASC
        `,
      [id],
    );

    return res.json({
      ...headerRows[0],

      detail: detailRows,
    });
  } catch (err) {
    console.error("Error GET detail serah-terima:", err);

    return res.status(500).json({
      error: "Gagal mengambil detail transaksi",
    });
  }
});

// ============================================================
// POST TRANSAKSI BARU
// ============================================================
//
// PENGANTARAN
// - dibuat admin/laundry
// - jumlah_kotor = linen bersih yang diantar
// - stok Laundry berkurang
//
// PENGAMBILAN
// - dibuat user ruangan
// - jumlah_diambil_infeksius +
//   jumlah_diambil_non_infeksius
// - kedua kategori boleh diisi bersamaan
// - stok ruangan tidak boleh minus
// - stok Laundry tidak langsung bertambah
// ============================================================

router.post("/", async (req, res) => {
  const {
    ruangan,
    tanggal,
    jenis_transaksi = "pengantaran",
    detail,

    // Khusus pengantaran
    nama_pengantar,
    tanda_tangan_pengantar,
  } = req.body;

  // ==========================================================
  // VALIDASI RUANGAN
  // ==========================================================

  if (!ruangan || !ruangan.trim()) {
    return res.status(400).json({
      error: "Ruangan wajib diisi",
    });
  }

  // ==========================================================
  // VALIDASI TANGGAL
  // ==========================================================

  if (!tanggal) {
    return res.status(400).json({
      error: "Tanggal wajib diisi",
    });
  }

  // ==========================================================
  // VALIDASI JENIS TRANSAKSI
  // ==========================================================

  if (!["pengantaran", "pengambilan"].includes(jenis_transaksi)) {
    return res.status(400).json({
      error: "Jenis transaksi tidak valid",
    });
  }

  // ==========================================================
  // VALIDASI DETAIL
  // ==========================================================

  if (!Array.isArray(detail) || detail.length === 0) {
    return res.status(400).json({
      error: "Detail linen tidak boleh kosong",
    });
  }

  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error,
      });
    }

    // ==========================================================
    // VALIDASI PENGANTARAN
    // Laundry/Admin wajib mengisi nama dan TTD pengantar
    // ==========================================================

    if (jenis_transaksi === "pengantaran") {
      if (!nama_pengantar || !nama_pengantar.trim()) {
        return res.status(400).json({
          error: "Nama pengantar wajib diisi",
        });
      }

      if (!tanda_tangan_pengantar) {
        return res.status(400).json({
          error: "Tanda tangan pengantar wajib diisi",
        });
      }
    }

    // ========================================================
    // CEK SIAPA YANG BOLEH MEMBUAT
    // ========================================================

    // --------------------------------------------------------
    // PENGANTARAN
    // --------------------------------------------------------

    if (jenis_transaksi === "pengantaran") {
      if (access.role !== "admin" && access.role !== "laundry") {
        return res.status(403).json({
          error: "Pengantaran hanya dapat dibuat oleh Laundry atau Admin",
        });
      }
    }

    // --------------------------------------------------------
    // PENGAMBILAN
    // --------------------------------------------------------

    if (jenis_transaksi === "pengambilan") {
      if (access.role !== "user") {
        return res.status(403).json({
          error: "Pengambilan hanya dapat dibuat oleh user ruangan",
        });
      }

      // User tidak boleh menentukan ruangan lain

      if (ruangan.trim() !== access.ruangan_nama) {
        return res.status(403).json({
          error: "User hanya dapat membuat pengambilan untuk ruangannya sendiri",
        });
      }
    }

    // ========================================================
    // BUAT CONNECTION
    // ========================================================

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // ======================================================
      // VALIDASI DETAIL
      // ======================================================

      const detailValid = [];

      for (const item of detail) {
        const jenisLinenId = Number(item.jenis_linen_id);

        const jumlahKotor = Number(item.jumlah_kotor) || 0;

        const jumlahInfeksius = Number(item.jumlah_diambil_infeksius) || 0;

        const jumlahNonInfeksius = Number(item.jumlah_diambil_non_infeksius) || 0;

        // ====================================================
        // VALIDASI ID LINEN
        // ====================================================

        if (!Number.isInteger(jenisLinenId) || jenisLinenId <= 0) {
          await connection.rollback();

          return res.status(400).json({
            error: "Jenis linen tidak valid",
          });
        }

        // ====================================================
        // JUMLAH TIDAK BOLEH NEGATIF
        // ====================================================

        if (jumlahKotor < 0 || jumlahInfeksius < 0 || jumlahNonInfeksius < 0) {
          await connection.rollback();

          return res.status(400).json({
            error: "Jumlah linen tidak boleh negatif",
          });
        }

        // ====================================================
        // VALIDASI PENGANTARAN
        // ====================================================

        if (jenis_transaksi === "pengantaran") {
          // Pengantaran hanya boleh mengisi
          // jumlah linen bersih yang diantar.

          if (jumlahInfeksius > 0 || jumlahNonInfeksius > 0) {
            await connection.rollback();

            return res.status(400).json({
              error: "Transaksi pengantaran hanya boleh berisi linen yang diantar",
            });
          }
        }

        // ====================================================
        // VALIDASI PENGAMBILAN
        // ====================================================

        if (jenis_transaksi === "pengambilan") {
          // Pengambilan tidak boleh menggunakan jumlah_kotor.

          if (jumlahKotor > 0) {
            await connection.rollback();

            return res.status(400).json({
              error: "Transaksi pengambilan tidak boleh menggunakan jumlah diantar",
            });
          }
        }

        // ====================================================
        // JIKA SEMUA JUMLAH NOL
        // ====================================================

        if (jumlahKotor === 0 && jumlahInfeksius === 0 && jumlahNonInfeksius === 0) {
          continue;
        }

        detailValid.push({
          jenis_linen_id: jenisLinenId,

          jumlah_kotor: jumlahKotor,

          jumlah_diambil_infeksius: jumlahInfeksius,

          jumlah_diambil_non_infeksius: jumlahNonInfeksius,

          keterangan: item.keterangan ? String(item.keterangan).trim() : null,
        });
      }

      // ======================================================
      // MINIMAL SATU DETAIL
      // ======================================================

      if (detailValid.length === 0) {
        await connection.rollback();

        return res.status(400).json({
          error: "Minimal satu jenis linen harus memiliki jumlah",
        });
      }

      // ======================================================
      // PENGANTARAN
      // CEK STOK LAUNDRY
      // ======================================================

      if (jenis_transaksi === "pengantaran") {
        for (const item of detailValid) {
          if (item.jumlah_kotor <= 0) {
            continue;
          }

          // Kunci baris jenis linen
          // agar stok Laundry aman.

          const [stokRows] = await connection.query(
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
            [item.jenis_linen_id],
          );

          if (stokRows.length === 0) {
            await connection.rollback();

            return res.status(404).json({
              error: `Jenis linen dengan ID ${item.jenis_linen_id} tidak ditemukan`,
            });
          }

          const stok = Number(stokRows[0].jumlah_stok) || 0;

          const namaLinen = stokRows[0].nama;

          if (stok < item.jumlah_kotor) {
            await connection.rollback();

            return res.status(400).json({
              error: `Stok ${namaLinen} tidak mencukupi. ` + `Stok tersedia: ${stok}, ` + `jumlah yang akan diantar: ${item.jumlah_kotor}.`,
            });
          }

          // Kurangi stok Laundry.

          await connection.query(
            `
            UPDATE jenis_linen
            SET jumlah_stok =
              jumlah_stok - ?
            WHERE id = ?
            `,
            [item.jumlah_kotor, item.jenis_linen_id],
          );
        }
      }

      // ======================================================
      // PENGAMBILAN
      // CEK STOK RUANGAN
      // ======================================================
      //
      // Stok ruangan:
      //
      // total_diantar
      // -
      // (total_infeksius + total_non_infeksius)
      //
      // Contoh:
      //
      // Stok UGD = 4
      // Infeksius = 5
      //
      // => DITOLAK
      //
      // Stok UGD = 4
      // Infeksius = 3
      // Non-infeksius = 1
      //
      // => BOLEH
      // ======================================================

      if (jenis_transaksi === "pengambilan") {
        // ----------------------------------------------------
        // KUNCI BARIS RUANGAN
        // ----------------------------------------------------
        //
        // Tujuannya agar dua transaksi pengambilan
        // untuk ruangan yang sama tidak melewati
        // pengecekan stok secara bersamaan.
        // ----------------------------------------------------

        const [ruanganRows] = await connection.query(
          `
            SELECT
              id,
              nama
            FROM ruangan
            WHERE nama = ?
            LIMIT 1
            FOR UPDATE
            `,
          [access.ruangan_nama],
        );

        if (ruanganRows.length === 0) {
          await connection.rollback();

          return res.status(404).json({
            error: "Ruangan user tidak ditemukan",
          });
        }

        // ----------------------------------------------------
        // GABUNGKAN JENIS LINEN YANG SAMA
        // ----------------------------------------------------
        //
        // Jika frontend mengirim jenis linen yang sama
        // lebih dari satu kali, semuanya dijumlahkan.
        // ----------------------------------------------------

        const permintaanPerLinen = new Map();

        for (const item of detailValid) {
          const jumlahPengambilan = (Number(item.jumlah_diambil_infeksius) || 0) + (Number(item.jumlah_diambil_non_infeksius) || 0);

          if (jumlahPengambilan <= 0) {
            continue;
          }

          const existing = permintaanPerLinen.get(item.jenis_linen_id) || {
            infeksius: 0,
            nonInfeksius: 0,
          };

          existing.infeksius += Number(item.jumlah_diambil_infeksius) || 0;

          existing.nonInfeksius += Number(item.jumlah_diambil_non_infeksius) || 0;

          permintaanPerLinen.set(item.jenis_linen_id, existing);
        }

        // ----------------------------------------------------
        // CEK SETIAP JENIS LINEN
        // ----------------------------------------------------

        for (const [jenisLinenId, permintaan] of permintaanPerLinen) {
          const jumlahAkanDiambil = permintaan.infeksius + permintaan.nonInfeksius;

          // --------------------------------------------------
          // CARI NAMA LINEN
          // --------------------------------------------------

          const [linenRows] = await connection.query(
            `
              SELECT
                id,
                nama
              FROM jenis_linen
              WHERE id = ?
              LIMIT 1
              `,
            [jenisLinenId],
          );

          if (linenRows.length === 0) {
            await connection.rollback();

            return res.status(404).json({
              error: `Jenis linen dengan ID ${jenisLinenId} tidak ditemukan`,
            });
          }

          const namaLinen = linenRows[0].nama;

          // --------------------------------------------------
          // HITUNG STOK RUANGAN
          // --------------------------------------------------
          //
          // Hanya transaksi sesuai ruangan user.
          //
          // Pengantaran:
          // + jumlah_kotor
          //
          // Pengambilan:
          // - infeksius
          // - non-infeksius
          //
          // Data lama yang sudah tersimpan juga
          // ikut dihitung.
          // --------------------------------------------------

          const [stokRuanganRows] = await connection.query(
            `
              SELECT

                COALESCE(
                  SUM(
                    CASE
                      WHEN st.jenis_transaksi =
                        'pengantaran'
                      THEN d.jumlah_kotor
                      ELSE 0
                    END
                  ),
                  0
                ) AS total_diantar,


                COALESCE(
                  SUM(
                    CASE
                      WHEN st.jenis_transaksi =
                        'pengambilan'
                      THEN
                        d.jumlah_diambil_infeksius +
                        d.jumlah_diambil_non_infeksius
                      ELSE 0
                    END
                  ),
                  0
                ) AS total_diambil

              FROM serah_terima st

              INNER JOIN serah_terima_detail d
                ON d.serah_terima_id =
                  st.id

              WHERE st.ruangan = ?

              AND d.jenis_linen_id = ?
              `,
            [access.ruangan_nama, jenisLinenId],
          );

          const totalDiantar = Number(stokRuanganRows[0].total_diantar) || 0;

          const totalDiambil = Number(stokRuanganRows[0].total_diambil) || 0;

          const stokSaatIni = totalDiantar - totalDiambil;

          // --------------------------------------------------
          // CEK STOK
          // --------------------------------------------------

          if (stokSaatIni < jumlahAkanDiambil) {
            await connection.rollback();

            return res.status(400).json({
              error:
                `Stok ${namaLinen} di ${access.ruangan_nama} tidak mencukupi. ` +
                `Stok tersedia: ${stokSaatIni}, ` +
                `jumlah yang akan diambil: ${jumlahAkanDiambil} ` +
                `(Infeksius: ${permintaan.infeksius}, ` +
                `Non-infeksius: ${permintaan.nonInfeksius}).`,
            });
          }
        }
      }

      // ======================================================
      // INSERT HEADER TRANSAKSI
      // ======================================================
      //
      // PENGANTARAN:
      // - nama_pengantar langsung disimpan
      // - TTD pengantar langsung disimpan
      // - user Laundry/Admin dicatat
      // - waktu pengantaran dicatat
      //
      // PENGAMBILAN:
      // - data pengantar dibuat NULL
      // ======================================================

      const [headerResult] = await connection.query(
        `
    INSERT INTO serah_terima
    (
      ruangan,
      tanggal,
      jenis_transaksi,
      status,
      dibuat_oleh_user_id,

      nama_pengantar,
      tanda_tangan_pengantar,
      diantar_oleh_user_id,
      diantar_at
    )

    VALUES (
      ?,
      ?,
      ?,
      'menunggu_konfirmasi',
      ?,

      ?,
      ?,
      ?,
      ?
    )
    `,
        [
          // Data transaksi
          ruangan.trim(),
          tanggal,
          jenis_transaksi,
          access.userId,

          // Data pengantar
          jenis_transaksi === "pengantaran" ? nama_pengantar.trim() : null,

          jenis_transaksi === "pengantaran" ? tanda_tangan_pengantar : null,

          jenis_transaksi === "pengantaran" ? access.userId : null,

          jenis_transaksi === "pengantaran" ? new Date() : null,
        ],
      );

      const serahTerimaId = headerResult.insertId;

      // ======================================================
      // INSERT DETAIL
      // ======================================================

      for (const item of detailValid) {
        await connection.query(
          `
          INSERT INTO serah_terima_detail
          (
            serah_terima_id,
            jenis_linen_id,

            jumlah_kotor,
            jumlah_bersih,

            jumlah_diambil_infeksius,
            jumlah_diambil_non_infeksius,

            jumlah_verifikasi_infeksius,
            jumlah_verifikasi_non_infeksius,

            verifikasi_infeksius,
            verifikasi_pengambilan,

            keterangan
          )

          VALUES (
            ?,
            ?,

            ?,
            0,

            ?,
            ?,

            0,
            0,

            0,
            0,

            ?
          )
          `,
          [serahTerimaId, item.jenis_linen_id, item.jumlah_kotor, item.jumlah_diambil_infeksius, item.jumlah_diambil_non_infeksius, item.keterangan],
        );
      }

      // ======================================================
      // COMMIT
      // ======================================================

      await connection.commit();

      return res.status(201).json({
        message: "Transaksi berhasil dibuat",

        id: serahTerimaId,

        ruangan: ruangan.trim(),

        jenis_transaksi: jenis_transaksi,

        status: "menunggu_konfirmasi",
      });
    } catch (err) {
      await connection.rollback();

      console.error("Error transaksi baru:", err);

      return res.status(500).json({
        error: "Gagal menyimpan transaksi",
      });
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error proses transaksi:", err);

    return res.status(500).json({
      error: "Gagal memproses transaksi",
    });
  }
});

// ============================================================
// KONFIRMASI PENERIMAAN PENGANTARAN
// ============================================================
//
// USER RUANGAN
//
// User mengisi:
// - nama_penerima
// - tanda_tangan
//
// Status BELUM langsung selesai.
// Menunggu TTD petugas Laundry.
// ============================================================

router.put("/:id/konfirmasi-penerimaan", async (req, res) => {
  const { id } = req.params;

  const { nama_penerima, tanda_tangan } = req.body;

  // ==========================================================
  // VALIDASI
  // ==========================================================

  if (!nama_penerima || !nama_penerima.trim()) {
    return res.status(400).json({
      error: "Nama penerima wajib diisi",
    });
  }

  if (!tanda_tangan) {
    return res.status(400).json({
      error: "Tanda tangan penerima wajib diisi",
    });
  }

  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error,
      });
    }

    // ========================================================
    // HANYA USER
    // ========================================================

    if (access.role !== "user") {
      return res.status(403).json({
        error: "Hanya user ruangan yang dapat melakukan konfirmasi penerimaan",
      });
    }

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // ======================================================
      // AMBIL TRANSAKSI
      // ======================================================

      const [rows] = await connection.query(
        `
            SELECT

              id,
              ruangan,
              jenis_transaksi,
              status,

              nama_penerima,
              tanda_tangan,

              tanda_tangan_pengantar

            FROM serah_terima

            WHERE id = ?

            AND ruangan = ?

            LIMIT 1

            FOR UPDATE
            `,
        [id, access.ruangan_nama],
      );

      if (rows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          error: "Transaksi tidak ditemukan atau bukan milik ruangan Anda",
        });
      }

      const transaksi = rows[0];

      // ======================================================
      // HARUS PENGANTARAN
      // ======================================================

      if (transaksi.jenis_transaksi !== "pengantaran") {
        await connection.rollback();

        return res.status(400).json({
          error: "Transaksi ini bukan transaksi pengantaran",
        });
      }

      // ======================================================
      // STATUS
      // ======================================================

      if (transaksi.status === "selesai") {
        await connection.rollback();

        return res.status(400).json({
          error: "Transaksi ini sudah selesai",
        });
      }

      // ======================================================
      // JIKA SUDAH TTD
      // ======================================================

      if (transaksi.tanda_tangan) {
        await connection.rollback();

        return res.status(400).json({
          error: "Penerimaan sudah dikonfirmasi",
        });
      }

      // ======================================================
      // SIMPAN TTD RUANGAN
      // ======================================================

      await connection.query(
        `
          UPDATE serah_terima

          SET

            nama_penerima = ?,

            tanda_tangan = ?,

            diterima_oleh_user_id = ?,

            diterima_at = NOW()

          WHERE id = ?
          `,
        [nama_penerima.trim(), tanda_tangan, access.userId, id],
      );

      // ======================================================
      // CEK STATUS
      // ======================================================

      await updateStatusIfComplete(connection, id);

      await connection.commit();

      return res.json({
        success: true,

        message: "Penerimaan berhasil dikonfirmasi. Transaksi pengantaran selesai.",

        status: "selesai",
      });
    } catch (err) {
      await connection.rollback();

      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error konfirmasi penerimaan:", err);

    return res.status(500).json({
      error: "Gagal melakukan konfirmasi penerimaan",
    });
  }
});

// ============================================================
// LEGACY KONFIRMASI
// ============================================================
//
// Dipertahankan supaya frontend lama tidak langsung rusak.
// Sekarang diarahkan ke endpoint yang benar.
// ============================================================

router.put("/:id/konfirmasi", async (req, res) => {
  const { id } = req.params;

  const { nama_penerima, tanda_tangan } = req.body;

  if (!nama_penerima || !nama_penerima.trim()) {
    return res.status(400).json({
      error: "Nama penerima wajib diisi",
    });
  }

  if (!tanda_tangan) {
    return res.status(400).json({
      error: "Tanda tangan penerima wajib diisi",
    });
  }

  req.body.nama_penerima = nama_penerima;

  req.body.tanda_tangan = tanda_tangan;

  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error,
      });
    }

    if (access.role !== "user") {
      return res.status(403).json({
        error: "Hanya user ruangan yang dapat melakukan konfirmasi",
      });
    }

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `
            SELECT

              id,
              ruangan,
              jenis_transaksi,
              status,
              tanda_tangan

            FROM serah_terima

            WHERE id = ?

            AND ruangan = ?

            LIMIT 1

            FOR UPDATE
            `,
        [id, access.ruangan_nama],
      );

      if (rows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          error: "Transaksi tidak ditemukan atau bukan milik ruangan Anda",
        });
      }

      const transaksi = rows[0];

      if (transaksi.jenis_transaksi !== "pengantaran") {
        await connection.rollback();

        return res.status(400).json({
          error: "Transaksi ini bukan transaksi pengantaran",
        });
      }

      if (transaksi.tanda_tangan) {
        await connection.rollback();

        return res.status(400).json({
          error: "Penerimaan sudah dikonfirmasi",
        });
      }

      await connection.query(
        `
          UPDATE serah_terima

          SET

            nama_penerima = ?,

            tanda_tangan = ?,

            diterima_oleh_user_id = ?,

            diterima_at = NOW()

          WHERE id = ?
          `,
        [nama_penerima.trim(), tanda_tangan, access.userId, id],
      );

      await connection.commit();

      return res.json({
        success: true,

        message: "Penerimaan berhasil dikonfirmasi",

        status: "menunggu_konfirmasi",
      });
    } catch (err) {
      await connection.rollback();

      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error legacy konfirmasi:", err);

    return res.status(500).json({
      error: "Gagal melakukan konfirmasi penerimaan",
    });
  }
});

// ============================================================
// KONFIRMASI PENGANTARAN OLEH LAUNDRY
// ============================================================
//
// Laundry mengisi:
// - nama_pengantar
// - tanda_tangan_pengantar
//
// Sistem juga mencatat:
// - diantar_oleh_user_id
// - diantar_at
//
// Setelah TTD Laundry + TTD ruangan ada:
// status = selesai
// ============================================================

router.put("/:id/konfirmasi-pengantaran", async (req, res) => {
  const { id } = req.params;

  const { nama_pengantar, tanda_tangan_pengantar } = req.body;

  // ==========================================================
  // VALIDASI NAMA
  // ==========================================================

  if (!nama_pengantar || !nama_pengantar.trim()) {
    return res.status(400).json({
      error: "Nama petugas Laundry wajib diisi",
    });
  }

  // ==========================================================
  // VALIDASI TTD
  // ==========================================================

  if (!tanda_tangan_pengantar) {
    return res.status(400).json({
      error: "Tanda tangan pengantar wajib diisi",
    });
  }

  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error,
      });
    }

    // ========================================================
    // HANYA ADMIN / LAUNDRY
    // ========================================================

    if (access.role !== "admin" && access.role !== "laundry") {
      return res.status(403).json({
        error: "Hanya Laundry atau Admin yang dapat memberikan tanda tangan pengantar",
      });
    }

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // ======================================================
      // AMBIL TRANSAKSI
      // ======================================================

      const [rows] = await connection.query(
        `
            SELECT

              id,
              ruangan,
              jenis_transaksi,
              status,

              tanda_tangan,
              tanda_tangan_pengantar,

              nama_penerima,
              diterima_oleh_user_id

            FROM serah_terima

            WHERE id = ?

            LIMIT 1

            FOR UPDATE
            `,
        [id],
      );

      if (rows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          error: "Transaksi tidak ditemukan",
        });
      }

      const transaksi = rows[0];

      // ======================================================
      // HARUS PENGANTARAN
      // ======================================================

      if (transaksi.jenis_transaksi !== "pengantaran") {
        await connection.rollback();

        return res.status(400).json({
          error: "Transaksi ini bukan transaksi pengantaran",
        });
      }

      // ======================================================
      // CEK STATUS
      // ======================================================

      if (transaksi.status === "selesai") {
        await connection.rollback();

        return res.status(400).json({
          error: "Transaksi ini sudah selesai",
        });
      }

      // ======================================================
      // RUANGAN HARUS SUDAH TTD
      // ======================================================

      if (!transaksi.tanda_tangan || !transaksi.diterima_oleh_user_id) {
        await connection.rollback();

        return res.status(400).json({
          error: "Ruangan belum melakukan konfirmasi penerimaan",
        });
      }

      // ======================================================
      // CEGAH TTD GANDA
      // ======================================================

      if (transaksi.tanda_tangan_pengantar) {
        await connection.rollback();

        return res.status(400).json({
          error: "Tanda tangan pengantar sudah diberikan",
        });
      }

      // ======================================================
      // SIMPAN TTD PENGANTAR
      // ======================================================

      await connection.query(
        `
          UPDATE serah_terima

          SET

            nama_pengantar = ?,

            tanda_tangan_pengantar = ?,

            diantar_oleh_user_id = ?,

            diantar_at = NOW()

          WHERE id = ?
          `,
        [nama_pengantar.trim(), tanda_tangan_pengantar, access.userId, id],
      );

      // ======================================================
      // KARENA KEDUA PIHAK SUDAH TTD,
      // TRANSAKSI MENJADI SELESAI
      // ======================================================

      await connection.query(
        `
          UPDATE serah_terima

          SET status = 'selesai'

          WHERE id = ?
          `,
        [id],
      );

      await connection.commit();

      return res.json({
        success: true,

        message: "Tanda tangan pengantar berhasil disimpan. Transaksi selesai.",

        id: Number(id),

        status: "selesai",
      });
    } catch (err) {
      await connection.rollback();

      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error konfirmasi pengantaran:", err);

    return res.status(500).json({
      error: "Gagal menyimpan tanda tangan pengantar",
    });
  }
});

// ============================================================
// KONFIRMASI PENYERAHAN PENGAMBILAN
// ============================================================
//
// USER RUANGAN
//
// User mengisi:
// - nama_penyerah
// - tanda_tangan_penyerah
//
// Setelah itu menunggu TTD Laundry.
// ============================================================

router.put("/:id/konfirmasi-penyerahan", async (req, res) => {
  const { id } = req.params;

  const { nama_penyerah, tanda_tangan_penyerah } = req.body;

  if (!nama_penyerah || !nama_penyerah.trim()) {
    return res.status(400).json({
      error: "Nama penyerah wajib diisi",
    });
  }

  if (!tanda_tangan_penyerah) {
    return res.status(400).json({
      error: "Tanda tangan penyerah wajib diisi",
    });
  }

  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error,
      });
    }

    if (access.role !== "user") {
      return res.status(403).json({
        error: "Hanya user ruangan yang dapat menyerahkan linen",
      });
    }

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      const [rows] = await connection.query(
        `
            SELECT

              id,
              ruangan,
              jenis_transaksi,
              status,

              nama_penyerah,
              tanda_tangan_penyerah,

              tanda_tangan_penerima_laundry

            FROM serah_terima

            WHERE id = ?

            AND ruangan = ?

            LIMIT 1

            FOR UPDATE
            `,
        [id, access.ruangan_nama],
      );

      if (rows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          error: "Transaksi tidak ditemukan atau bukan milik ruangan Anda",
        });
      }

      const transaksi = rows[0];

      // ====================================================
      // HARUS PENGAMBILAN
      // ====================================================

      if (transaksi.jenis_transaksi !== "pengambilan") {
        await connection.rollback();

        return res.status(400).json({
          error: "Transaksi ini bukan transaksi pengambilan",
        });
      }

      // ====================================================
      // CEGAH SELESAI
      // ====================================================

      if (transaksi.status === "selesai") {
        await connection.rollback();

        return res.status(400).json({
          error: "Transaksi sudah selesai",
        });
      }

      // ====================================================
      // CEGAH TTD GANDA
      // ====================================================

      if (transaksi.tanda_tangan_penyerah) {
        await connection.rollback();

        return res.status(400).json({
          error: "Tanda tangan penyerah sudah diberikan",
        });
      }

      // ====================================================
      // SIMPAN TTD USER
      // ====================================================

      await connection.query(
        `
          UPDATE serah_terima

          SET

            nama_penyerah = ?,

            tanda_tangan_penyerah = ?,

            diserahkan_oleh_user_id = ?,

            diserahkan_at = NOW()

          WHERE id = ?
          `,
        [nama_penyerah.trim(), tanda_tangan_penyerah, access.userId, id],
      );

      await connection.commit();

      return res.json({
        success: true,

        message: "Penyerahan linen berhasil dikonfirmasi. Menunggu penerimaan Laundry.",

        status: "menunggu_konfirmasi",
      });
    } catch (err) {
      await connection.rollback();

      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error konfirmasi penyerahan:", err);

    return res.status(500).json({
      error: "Gagal menyimpan penyerahan linen",
    });
  }
});

// ============================================================
// KONFIRMASI PENERIMAAN PENGAMBILAN OLEH LAUNDRY
// ============================================================
//
// Laundry:
// - menerima linen kotor
// - memberikan TTD
// - transaksi pengambilan menjadi selesai
// - otomatis membuat proses_laundry
//
// Data awal:
// jumlah_diambil_infeksius
// jumlah_diambil_non_infeksius
//
// Disimpan di proses_laundry sebagai data awal.
// ============================================================

router.put("/:id/konfirmasi-penerimaan-laundry", async (req, res) => {
  const { id } = req.params;

  const { tanda_tangan_penerima_laundry } = req.body;

  if (!tanda_tangan_penerima_laundry) {
    return res.status(400).json({
      error: "Tanda tangan penerima Laundry wajib diisi",
    });
  }

  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error,
      });
    }

    if (access.role !== "admin" && access.role !== "laundry") {
      return res.status(403).json({
        error: "Hanya Laundry atau Admin yang dapat menerima linen",
      });
    }

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // ======================================================
      // AMBIL HEADER
      // ======================================================

      const [headerRows] = await connection.query(
        `
            SELECT

              id,
              ruangan,
              jenis_transaksi,
              status,

              nama_penyerah,
              tanda_tangan_penyerah,

              tanda_tangan_penerima_laundry

            FROM serah_terima

            WHERE id = ?

            LIMIT 1

            FOR UPDATE
            `,
        [id],
      );

      if (headerRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          error: "Transaksi tidak ditemukan",
        });
      }

      const transaksi = headerRows[0];

      // ======================================================
      // HARUS PENGAMBILAN
      // ======================================================

      if (transaksi.jenis_transaksi !== "pengambilan") {
        await connection.rollback();

        return res.status(400).json({
          error: "Transaksi ini bukan transaksi pengambilan",
        });
      }

      // ======================================================
      // USER HARUS SUDAH MENYERAHKAN
      // ======================================================

      if (!transaksi.tanda_tangan_penyerah) {
        await connection.rollback();

        return res.status(400).json({
          error: "Ruangan belum melakukan tanda tangan penyerahan",
        });
      }

      // ======================================================
      // CEGAH TTD GANDA
      // ======================================================

      if (transaksi.tanda_tangan_penerima_laundry) {
        await connection.rollback();

        return res.status(400).json({
          error: "Tanda tangan penerima Laundry sudah diberikan",
        });
      }

      // ======================================================
      // AMBIL DETAIL
      // ======================================================

      const [detailRows] = await connection.query(
        `
            SELECT

              d.id,
              d.jenis_linen_id,

              d.jumlah_diambil_infeksius,
              d.jumlah_diambil_non_infeksius,

              d.jumlah_verifikasi_infeksius,
              d.jumlah_verifikasi_non_infeksius

            FROM serah_terima_detail d

            WHERE d.serah_terima_id = ?

            FOR UPDATE
            `,
        [id],
      );

      if (detailRows.length === 0) {
        await connection.rollback();

        return res.status(400).json({
          error: "Detail pengambilan tidak ditemukan",
        });
      }

      // ======================================================
      // SIMPAN TTD LAUNDRY
      // ======================================================

      await connection.query(
        `
          UPDATE serah_terima

          SET

            tanda_tangan_penerima_laundry = ?,

            diterima_laundry_oleh_user_id = ?,

            diterima_laundry_at = NOW(),

            status = 'selesai'

          WHERE id = ?
          `,
        [tanda_tangan_penerima_laundry, access.userId, id],
      );

      // ======================================================
      // BUAT PROSES LAUNDRY
      // ======================================================

      for (const item of detailRows) {
        const jumlahInfeksius = Number(item.jumlah_diambil_infeksius) || 0;

        const jumlahNonInfeksius = Number(item.jumlah_diambil_non_infeksius) || 0;

        const jumlahTotal = jumlahInfeksius + jumlahNonInfeksius;

        if (jumlahTotal <= 0) {
          continue;
        }

        // Cek apakah sudah ada proses

        const [existingProcess] = await connection.query(
          `
              SELECT
                id
              FROM proses_laundry

              WHERE serah_terima_detail_id = ?

              LIMIT 1
              `,
          [item.id],
        );

        if (existingProcess.length > 0) {
          continue;
        }

        await connection.query(
          `
            INSERT INTO proses_laundry
            (
              serah_terima_detail_id,
              jenis_linen_id,

              jumlah_infeksius,
              jumlah_non_infeksius,
              jumlah_total,

              jumlah_verifikasi_infeksius,
              jumlah_verifikasi_non_infeksius,

              status

            )

            VALUES (
              ?,
              ?,

              ?,
              ?,
              ?,

              0,
              0,

              'menunggu_cuci'
            )
            `,
          [item.id, item.jenis_linen_id, jumlahInfeksius, jumlahNonInfeksius, jumlahTotal],
        );
      }

      // ======================================================
      // COMMIT
      // ======================================================

      await connection.commit();

      return res.json({
        success: true,

        message: "Penerimaan Laundry berhasil. Linen masuk ke proses Laundry.",

        status: "selesai",
      });
    } catch (err) {
      await connection.rollback();

      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error penerimaan Laundry:", err);

    return res.status(500).json({
      error: "Gagal menyimpan penerimaan Laundry",
    });
  }
});

// ============================================================
// UPDATE TRANSAKSI
// ============================================================
//
// Hanya untuk PENGANTARAN.
//
// Hanya Admin/Laundry.
//
// Tidak boleh diedit jika:
// - selesai
// - sudah ada TTD
// - sudah masuk proses Laundry
// ============================================================

router.put("/:id", async (req, res) => {
  const { id } = req.params;

  const { ruangan, tanggal, detail } = req.body;

  if (!ruangan || !ruangan.trim()) {
    return res.status(400).json({
      error: "Ruangan wajib diisi",
    });
  }

  if (!tanggal) {
    return res.status(400).json({
      error: "Tanggal wajib diisi",
    });
  }

  if (!Array.isArray(detail) || detail.length === 0) {
    return res.status(400).json({
      error: "Detail linen tidak boleh kosong",
    });
  }

  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error,
      });
    }

    if (access.role !== "admin" && access.role !== "laundry") {
      return res.status(403).json({
        error: "User ruangan tidak dapat mengedit transaksi",
      });
    }

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // ======================================================
      // AMBIL TRANSAKSI
      // ======================================================

      const [existingRows] = await connection.query(
        `
          SELECT

            id,
            jenis_transaksi,
            status,

            tanda_tangan,
            tanda_tangan_pengantar

          FROM serah_terima

          WHERE id = ?

          LIMIT 1

          FOR UPDATE
          `,
        [id],
      );

      if (existingRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          error: "Transaksi tidak ditemukan",
        });
      }

      const transaksi = existingRows[0];

      // ======================================================
      // HARUS PENGANTARAN
      // ======================================================

      if (transaksi.jenis_transaksi !== "pengantaran") {
        await connection.rollback();

        return res.status(400).json({
          error: "Hanya transaksi pengantaran yang dapat diedit",
        });
      }

      // ======================================================
      // TIDAK BOLEH JIKA SUDAH SELESAI
      // ======================================================

      if (transaksi.status === "selesai") {
        await connection.rollback();

        return res.status(400).json({
          error: "Transaksi yang sudah selesai tidak dapat diedit",
        });
      }

      // ======================================================
      // TIDAK BOLEH JIKA SUDAH ADA TTD
      // ======================================================

      if (transaksi.tanda_tangan || transaksi.tanda_tangan_pengantar) {
        await connection.rollback();

        return res.status(400).json({
          error: "Transaksi tidak dapat diedit karena sudah ada tanda tangan",
        });
      }

      // ======================================================
      // CEK PROSES LAUNDRY
      // ======================================================

      const [existingProcess] = await connection.query(
        `
          SELECT
            p.id

          FROM proses_laundry p

          JOIN serah_terima_detail d
            ON d.id =
              p.serah_terima_detail_id

          WHERE d.serah_terima_id = ?

          LIMIT 1
          `,
        [id],
      );

      if (existingProcess.length > 0) {
        await connection.rollback();

        return res.status(400).json({
          error: "Transaksi tidak dapat diedit karena sudah masuk proses Laundry",
        });
      }

      // ======================================================
      // AMBIL DETAIL LAMA
      // ======================================================

      const [oldDetails] = await connection.query(
        `
          SELECT

            jenis_linen_id,
            jumlah_kotor

          FROM serah_terima_detail

          WHERE serah_terima_id = ?

          FOR UPDATE
          `,
        [id],
      );

      // ======================================================
      // KEMBALIKAN STOK LAMA
      // ======================================================

      for (const oldItem of oldDetails) {
        const jumlahLama = Number(oldItem.jumlah_kotor) || 0;

        if (jumlahLama <= 0) {
          continue;
        }

        await connection.query(
          `
          UPDATE jenis_linen

          SET
            jumlah_stok =
              jumlah_stok + ?

          WHERE id = ?
          `,
          [jumlahLama, oldItem.jenis_linen_id],
        );
      }

      // ======================================================
      // VALIDASI DETAIL BARU
      // ======================================================

      const detailValid = [];

      for (const item of detail) {
        const jenisLinenId = Number(item.jenis_linen_id);

        const jumlahKotor = Number(item.jumlah_kotor) || 0;

        if (!Number.isInteger(jenisLinenId) || jenisLinenId <= 0) {
          await connection.rollback();

          return res.status(400).json({
            error: "Jenis linen tidak valid",
          });
        }

        if (jumlahKotor < 0) {
          await connection.rollback();

          return res.status(400).json({
            error: "Jumlah linen tidak boleh negatif",
          });
        }

        if (jumlahKotor === 0) {
          continue;
        }

        detailValid.push({
          jenis_linen_id: jenisLinenId,

          jumlah_kotor: jumlahKotor,

          keterangan: item.keterangan ? String(item.keterangan).trim() : null,
        });
      }

      if (detailValid.length === 0) {
        await connection.rollback();

        return res.status(400).json({
          error: "Minimal satu jenis linen harus memiliki jumlah diantar",
        });
      }

      // ======================================================
      // CEK STOK BARU
      // ======================================================

      for (const item of detailValid) {
        const [stokRows] = await connection.query(
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
          [item.jenis_linen_id],
        );

        if (stokRows.length === 0) {
          await connection.rollback();

          return res.status(404).json({
            error: `Jenis linen dengan ID ${item.jenis_linen_id} tidak ditemukan`,
          });
        }

        const stok = Number(stokRows[0].jumlah_stok);

        const namaLinen = stokRows[0].nama;

        if (stok < item.jumlah_kotor) {
          await connection.rollback();

          return res.status(400).json({
            error: `Stok ${namaLinen} tidak mencukupi. ` + `Stok tersedia: ${stok}, ` + `jumlah yang akan diantar: ${item.jumlah_kotor}.`,
          });
        }

        await connection.query(
          `
          UPDATE jenis_linen

          SET
            jumlah_stok =
              jumlah_stok - ?

          WHERE id = ?
          `,
          [item.jumlah_kotor, item.jenis_linen_id],
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
        [ruangan.trim(), tanggal, id],
      );

      // ======================================================
      // HAPUS DETAIL LAMA
      // ======================================================

      await connection.query(
        `
        DELETE FROM serah_terima_detail

        WHERE serah_terima_id = ?
        `,
        [id],
      );

      // ======================================================
      // INSERT DETAIL BARU
      // ======================================================

      for (const item of detailValid) {
        await connection.query(
          `
          INSERT INTO serah_terima_detail
          (
            serah_terima_id,
            jenis_linen_id,

            jumlah_kotor,
            jumlah_bersih,

            jumlah_diambil_infeksius,
            jumlah_diambil_non_infeksius,

            jumlah_verifikasi_infeksius,
            jumlah_verifikasi_non_infeksius,

            verifikasi_infeksius,
            verifikasi_pengambilan,

            keterangan
          )

          VALUES (
            ?,
            ?,

            ?,
            0,

            0,
            0,

            0,
            0,

            0,
            0,

            ?
          )
          `,
          [id, item.jenis_linen_id, item.jumlah_kotor, item.keterangan],
        );
      }

      await connection.commit();

      return res.json({
        success: true,

        message: "Transaksi berhasil diperbarui",
      });
    } catch (err) {
      await connection.rollback();

      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error update transaksi:", err);

    return res.status(500).json({
      error: "Gagal memperbarui transaksi",
    });
  }
});

// ============================================================
// DELETE TRANSAKSI
// ============================================================
//
// Hanya pengantaran.
// Stok dikembalikan.
// ============================================================

router.delete("/:id", async (req, res) => {
  const { id } = req.params;

  try {
    const access = await getAccessInfo(req);

    if (access.error) {
      return res.status(403).json({
        error: access.error,
      });
    }

    if (access.role !== "admin" && access.role !== "laundry") {
      return res.status(403).json({
        error: "User ruangan tidak dapat menghapus transaksi",
      });
    }

    const connection = await db.getConnection();

    try {
      await connection.beginTransaction();

      // ======================================================
      // AMBIL TRANSAKSI
      // ======================================================

      const [transactionRows] = await connection.query(
        `
          SELECT

            id,
            jenis_transaksi,
            status,

            tanda_tangan,
            tanda_tangan_pengantar

          FROM serah_terima

          WHERE id = ?

          LIMIT 1

          FOR UPDATE
          `,
        [id],
      );

      if (transactionRows.length === 0) {
        await connection.rollback();

        return res.status(404).json({
          error: "Transaksi tidak ditemukan",
        });
      }

      const transaksi = transactionRows[0];

      // ======================================================
      // HARUS PENGANTARAN
      // ======================================================

      if (transaksi.jenis_transaksi !== "pengantaran") {
        await connection.rollback();

        return res.status(400).json({
          error: "Hanya transaksi pengantaran yang dapat dihapus",
        });
      }

      // ======================================================
      // TIDAK BOLEH HAPUS JIKA SUDAH ADA TTD
      // ======================================================

      if (transaksi.tanda_tangan || transaksi.tanda_tangan_pengantar) {
        await connection.rollback();

        return res.status(400).json({
          error: "Transaksi tidak dapat dihapus karena sudah ada tanda tangan",
        });
      }

      // ======================================================
      // AMBIL DETAIL
      // ======================================================

      const [detailRows] = await connection.query(
        `
          SELECT

            jenis_linen_id,
            jumlah_kotor

          FROM serah_terima_detail

          WHERE serah_terima_id = ?

          FOR UPDATE
          `,
        [id],
      );

      // ======================================================
      // KEMBALIKAN STOK
      // ======================================================

      for (const item of detailRows) {
        const jumlah = Number(item.jumlah_kotor) || 0;

        if (jumlah <= 0) {
          continue;
        }

        await connection.query(
          `
          UPDATE jenis_linen

          SET

            jumlah_stok =
              jumlah_stok + ?

          WHERE id = ?
          `,
          [jumlah, item.jenis_linen_id],
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
        [id],
      );

      // ======================================================
      // HAPUS HEADER
      // ======================================================

      const [result] = await connection.query(
        `
          DELETE FROM serah_terima

          WHERE id = ?
          `,
        [id],
      );

      if (result.affectedRows === 0) {
        await connection.rollback();

        return res.status(404).json({
          error: "Transaksi tidak ditemukan",
        });
      }

      await connection.commit();

      return res.json({
        success: true,

        message: "Transaksi berhasil dihapus dan stok Laundry dikembalikan",
      });
    } catch (err) {
      await connection.rollback();

      throw err;
    } finally {
      connection.release();
    }
  } catch (err) {
    console.error("Error delete transaksi:", err);

    return res.status(500).json({
      error: "Gagal menghapus transaksi",
    });
  }
});

// ============================================================
// EXPORT ROUTER
// ============================================================

module.exports = router;
