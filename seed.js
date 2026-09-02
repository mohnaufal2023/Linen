const db = require('./config/db');

const daftarLinen = [
  'Alas Mayo',
  'BajuOperasi Kecil',
  'BajuOperasiBesar',
  'Barak Scot',
  'Baju OK',
  'Celana OK',
  'DukBenang',
  'DukBiasa',
  'DukLobang',
  'HandukBesar',
  'Handuk Kecil',
  'Jas Operasi',
  'Luer',
  'Loa',
  'Lob',
  'Lp',
  'Laken',
  'Mitela'
];

async function seed() {
  try {
    for (let i = 0; i < daftarLinen.length; i++) {
      await db.query(
        'INSERT INTO jenis_linen (nama, urutan) VALUES (?, ?)',
        [daftarLinen[i], i + 1]
      );
      console.log(`Berhasil tambah: ${daftarLinen[i]}`);
    }
    console.log('Semua data jenis linen berhasil dimasukkan!');
    process.exit(0);
  } catch (err) {
    console.error('Terjadi error:', err.message);
    process.exit(1);
  }
}

seed();