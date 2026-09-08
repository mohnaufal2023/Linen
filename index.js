const express = require('express');
const app = express();
require('dotenv').config();

app.use(express.json());
app.use(express.static('public'));

const jenisLinenRoutes = require('./routes/JenisLinen');
app.use('/api/jenis-linen', jenisLinenRoutes);
const serahTerimaRoutes = require('./routes/serahTerima');
app.use('/api/serah-terima', serahTerimaRoutes);

const stokRuanganRoutes = require('./routes/stokRuangan');
app.use('/api/stok-ruangan', stokRuanganRoutes);

const ruanganRoutes = require('./routes/ruangan');
app.use('/api/ruangan', ruanganRoutes);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server jalan di http://localhost:${PORT}`));