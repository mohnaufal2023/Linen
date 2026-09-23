const express = require("express");
const router = express.Router();
const db = require("../config/db");

// ===============================
// GET semua permintaan linen
// ===============================
router.get("/", async (req, res) => {
    try {
        const [rows] = await db.query(`
            SELECT
                p.id,
                p.ruangan_id,
                r.nama AS nama_ruangan,
                p.dibuat_oleh_user_id,
                p.tanggal,
                p.status,
                p.keterangan,
                p.created_at
            FROM permintaan_linen p
            JOIN ruangan r ON r.id = p.ruangan_id
            ORDER BY p.created_at DESC
        `);

        res.json(rows);
    } catch (error) {
        console.error("Error GET permintaan linen:", error);
        res.status(500).json({
            error: "Gagal mengambil data permintaan linen"
        });
    }
});

// ===============================
// GET detail permintaan
// ===============================
router.get("/:id", async (req, res) => {
    try {
        const { id } = req.params;

        const [permintaan] = await db.query(`
            SELECT
                p.id,
                p.ruangan_id,
                r.nama AS nama_ruangan,
                p.dibuat_oleh_user_id,
                p.tanggal,
                p.status,
                p.keterangan,
                p.created_at
            FROM permintaan_linen p
            JOIN ruangan r ON r.id = p.ruangan_id
            WHERE p.id = ?
        `, [id]);

        if (permintaan.length === 0) {
            return res.status(404).json({
                error: "Permintaan linen tidak ditemukan"
            });
        }

        const [detail] = await db.query(`
            SELECT
                d.id,
                d.jenis_linen_id,
                j.nama AS nama_linen,
                d.jumlah_diminta,
                d.jumlah_diantar,
                d.keterangan
            FROM permintaan_linen_detail d
            JOIN jenis_linen j ON j.id = d.jenis_linen_id
            WHERE d.permintaan_linen_id = ?
            ORDER BY j.urutan ASC
        `, [id]);

        res.json({
            permintaan: permintaan[0],
            detail
        });
    } catch (error) {
        console.error("Error GET detail permintaan linen:", error);
        res.status(500).json({
            error: "Gagal mengambil detail permintaan linen"
        });
    }
});

// ===============================
// POST membuat permintaan linen
// ===============================
router.post("/", async (req, res) => {
    const connection = await db.getConnection();

    try {
        const {
            ruangan_id,
            dibuat_oleh_user_id,
            keterangan,
            detail
        } = req.body;

        // Validasi data utama
        if (!ruangan_id || !dibuat_oleh_user_id) {
            return res.status(400).json({
                error: "Ruangan dan user wajib diisi"
            });
        }

        // Validasi detail
        if (!Array.isArray(detail) || detail.length === 0) {
            return res.status(400).json({
                error: "Minimal harus ada satu jenis linen"
            });
        }

        // Validasi setiap detail
        for (const item of detail) {
            if (!item.jenis_linen_id || !item.jumlah_diminta) {
                return res.status(400).json({
                    error: "Jenis linen dan jumlah wajib diisi"
                });
            }

            if (Number(item.jumlah_diminta) <= 0) {
                return res.status(400).json({
                    error: "Jumlah linen harus lebih dari 0"
                });
            }
        }

        await connection.beginTransaction();

        // Simpan header permintaan
        const [result] = await connection.query(`
            INSERT INTO permintaan_linen
            (
                ruangan_id,
                dibuat_oleh_user_id,
                keterangan
            )
            VALUES (?, ?, ?)
        `, [
            ruangan_id,
            dibuat_oleh_user_id,
            keterangan || null
        ]);

        const permintaanId = result.insertId;

        // Simpan detail linen
        for (const item of detail) {
            await connection.query(`
                INSERT INTO permintaan_linen_detail
                (
                    permintaan_linen_id,
                    jenis_linen_id,
                    jumlah_diminta,
                    jumlah_diantar
                )
                VALUES (?, ?, ?, ?)
            `, [
                permintaanId,
                item.jenis_linen_id,
                item.jumlah_diminta,
                item.jumlah_diminta
            ]);
        }

        await connection.commit();

        res.status(201).json({
            message: "Permintaan linen berhasil dibuat",
            id: permintaanId
        });

    } catch (error) {
        await connection.rollback();

        console.error("Error POST permintaan linen:", error);

        res.status(500).json({
            error: "Gagal membuat permintaan linen"
        });

    } finally {
        connection.release();
    }
});

// ===============================
// PUT memproses permintaan linen
// ===============================
router.put("/:id/proses", async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { id } = req.params;
        const { detail, keterangan } = req.body;

        // Validasi detail
        if (!Array.isArray(detail) || detail.length === 0) {
            return res.status(400).json({
                error: "Detail permintaan wajib diisi"
            });
        }

        await connection.beginTransaction();

        // Cek permintaan
        const [permintaan] = await connection.query(`
            SELECT id, status
            FROM permintaan_linen
            WHERE id = ?
            FOR UPDATE
        `, [id]);

        if (permintaan.length === 0) {
            await connection.rollback();

            return res.status(404).json({
                error: "Permintaan linen tidak ditemukan"
            });
        }

        if (permintaan[0].status !== "menunggu_laundry") {
            await connection.rollback();

            return res.status(400).json({
                error: "Permintaan sudah diproses"
            });
        }

        // Update setiap detail
        for (const item of detail) {
            const jumlahDiantar = Number(item.jumlah_diantar);

            if (!item.id || !Number.isInteger(jumlahDiantar)) {
                await connection.rollback();

                return res.status(400).json({
                    error: "Data jumlah linen tidak valid"
                });
            }

            if (jumlahDiantar < 0) {
                await connection.rollback();

                return res.status(400).json({
                    error: "Jumlah diantar tidak boleh negatif"
                });
            }

            // Pastikan jumlah diantar tidak melebihi jumlah diminta
            const [detailLama] = await connection.query(`
                SELECT jumlah_diminta
                FROM permintaan_linen_detail
                WHERE id = ?
                  AND permintaan_linen_id = ?
            `, [item.id, id]);

            if (detailLama.length === 0) {
                await connection.rollback();

                return res.status(400).json({
                    error: "Detail permintaan tidak ditemukan"
                });
            }

            if (jumlahDiantar > detailLama[0].jumlah_diminta) {
                await connection.rollback();

                return res.status(400).json({
                    error: "Jumlah diantar tidak boleh lebih besar dari jumlah diminta"
                });
            }

            await connection.query(`
                UPDATE permintaan_linen_detail
                SET
                    jumlah_diantar = ?,
                    keterangan = ?
                WHERE id = ?
                  AND permintaan_linen_id = ?
            `, [
                jumlahDiantar,
                item.keterangan || null,
                item.id,
                id
            ]);
        }

        // Update permintaan
        await connection.query(`
            UPDATE permintaan_linen
            SET
                status = 'diproses',
                keterangan = ?
            WHERE id = ?
        `, [
            keterangan || null,
            id
        ]);

        await connection.commit();

        res.json({
            message: "Permintaan linen berhasil diproses",
            id: Number(id)
        });

    } catch (error) {
        await connection.rollback();

        console.error("Error proses permintaan linen:", error);

        res.status(500).json({
            error: "Gagal memproses permintaan linen"
        });

    } finally {
        connection.release();
    }
});

// ===============================
// POST mengirim permintaan menjadi
// transaksi pengantaran
// ===============================
router.post("/:id/kirim", async (req, res) => {
    const connection = await db.getConnection();

    try {
        const { id } = req.params;

        const {
            nama_pengantar,
            tanda_tangan_pengantar
        } = req.body;

        // ===============================
        // VALIDASI LOGIN
        // ===============================

        const user = req.session?.user;

        if (!user) {
            return res.status(401).json({
                error: "Silakan login terlebih dahulu"
            });
        }

        // ===============================
        // VALIDASI ROLE
        // ===============================

        if (user.role !== "laundry" && user.role !== "admin") {
            return res.status(403).json({
                error: "Hanya Laundry atau Admin yang dapat mengirim linen"
            });
        }

        // ===============================
        // VALIDASI PENGANTAR
        // ===============================

        if (!nama_pengantar || !nama_pengantar.trim()) {
            return res.status(400).json({
                error: "Nama pengantar wajib diisi"
            });
        }

        if (!tanda_tangan_pengantar) {
            return res.status(400).json({
                error: "Tanda tangan pengantar wajib diisi"
            });
        }

        await connection.beginTransaction();

        // ===============================
        // CEK PERMINTAAN
        // ===============================

        const [permintaanRows] = await connection.query(`
            SELECT
                p.id,
                p.ruangan_id,
                r.nama AS nama_ruangan,
                p.tanggal,
                p.status,
                p.serah_terima_id
            FROM permintaan_linen p
            JOIN ruangan r
                ON r.id = p.ruangan_id
            WHERE p.id = ?
            FOR UPDATE
        `, [id]);

        if (permintaanRows.length === 0) {
            await connection.rollback();

            return res.status(404).json({
                error: "Permintaan linen tidak ditemukan"
            });
        }

        const permintaan = permintaanRows[0];

        // ===============================
        // CEK STATUS
        // ===============================

        if (permintaan.status !== "diproses") {
            await connection.rollback();

            return res.status(400).json({
                error: "Permintaan belum siap untuk dikirim"
            });
        }

        // ===============================
        // CEK SUDAH PERNAH DIKIRIM
        // ===============================

        if (permintaan.serah_terima_id) {
            await connection.rollback();

            return res.status(400).json({
                error: "Permintaan ini sudah dibuat menjadi transaksi pengantaran"
            });
        }

        // ===============================
        // AMBIL DETAIL PERMINTAAN
        // ===============================

        const [detailRows] = await connection.query(`
            SELECT
                d.id,
                d.jenis_linen_id,
                d.jumlah_diminta,
                d.jumlah_diantar,
                d.keterangan
            FROM permintaan_linen_detail d
            WHERE d.permintaan_linen_id = ?
            FOR UPDATE
        `, [id]);

        // ===============================
        // HANYA DETAIL YANG DIANTAR
        // ===============================

        const detailKirim = detailRows.filter(
            item => Number(item.jumlah_diantar) > 0
        );

        if (detailKirim.length === 0) {
            await connection.rollback();

            return res.status(400).json({
                error: "Tidak ada linen yang akan diantar"
            });
        }

        // ===============================
        // CEK STOK LAUNDRY
        // ===============================

        for (const item of detailKirim) {

            const jumlahDiantar =
                Number(item.jumlah_diantar);

            const [stokRows] = await connection.query(`
                SELECT
                    id,
                    nama,
                    jumlah_stok
                FROM jenis_linen
                WHERE id = ?
                FOR UPDATE
            `, [
                item.jenis_linen_id
            ]);

            if (stokRows.length === 0) {
                await connection.rollback();

                return res.status(404).json({
                    error:
                        `Jenis linen dengan ID ${item.jenis_linen_id} tidak ditemukan`
                });
            }

            const stok =
                Number(stokRows[0].jumlah_stok) || 0;

            const namaLinen =
                stokRows[0].nama;

            if (stok < jumlahDiantar) {
                await connection.rollback();

                return res.status(400).json({
                    error:
                        `Stok ${namaLinen} tidak mencukupi. ` +
                        `Stok tersedia: ${stok}, ` +
                        `jumlah yang akan diantar: ${jumlahDiantar}.`
                });
            }
        }

        // ===============================
        // KURANGI STOK LAUNDRY
        // ===============================

        for (const item of detailKirim) {

            await connection.query(`
                UPDATE jenis_linen
                SET jumlah_stok = jumlah_stok - ?
                WHERE id = ?
            `, [
                Number(item.jumlah_diantar),
                item.jenis_linen_id
            ]);
        }

        // ===============================
        // BUAT TRANSAKSI SERAH TERIMA
        // ===============================

        const [headerResult] = await connection.query(`
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
                'pengantaran',
                'menunggu_konfirmasi',
                ?,

                ?,
                ?,
                ?,
                ?
            )
        `, [
            permintaan.nama_ruangan,
            permintaan.tanggal,
            user.id || null,

            nama_pengantar.trim(),
            tanda_tangan_pengantar,
            user.id || null,
            new Date()
        ]);

        const serahTerimaId =
            headerResult.insertId;

        // ===============================
        // BUAT DETAIL SERAH TERIMA
        // ===============================

        for (const item of detailKirim) {

            await connection.query(`
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
            `, [
                serahTerimaId,
                item.jenis_linen_id,
                Number(item.jumlah_diantar),
                item.keterangan || null
            ]);
        }

        // ===============================
        // HUBUNGKAN PERMINTAAN
        // DENGAN SERAH TERIMA
        // ===============================

        await connection.query(`
            UPDATE permintaan_linen
            SET
                status = 'dikirim',
                serah_terima_id = ?
            WHERE id = ?
        `, [
            serahTerimaId,
            id
        ]);

        // ===============================
        // COMMIT
        // ===============================

        await connection.commit();

        return res.status(201).json({
            message:
                "Permintaan berhasil dibuat menjadi transaksi pengantaran",

            permintaan_id:
                Number(id),

            serah_terima_id:
                serahTerimaId,

            ruangan:
                permintaan.nama_ruangan,

            status:
                "dikirim"
        });

    } catch (error) {

        await connection.rollback();

        console.error(
            "Error mengirim permintaan linen:",
            error
        );

        return res.status(500).json({
            error:
                "Gagal mengirim permintaan linen"
        });

    } finally {

        connection.release();
    }
});

module.exports = router;